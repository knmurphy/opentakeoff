// Region map tests — regions.ts is pure (no DOM, no pdf.js), so it runs
// straight under node. Run with: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  regionAt, regionPath, regionLabel, hitRegion, formatHitRegion, cleanRegions,
  setSignature, serializeRegionMap, sanitizeRegionMap, sanitizeRegionOverrides,
  applyOverrides, groupOf, toNormBbox, REGION_MAP_SCHEMA, REGION_DETECTOR_VERSION, REGION_KINDS, REGION_PARENT,
  aspectBucket, capStatics, assignGroupIds, mapGroups, matchGroup, resolveOverrides,
  type Region, type SheetRegions, type GroupSig, type RegionOverrides,
} from "../src/lib/regions.ts";

const R = (id: string, kind: Region["kind"], bbox: Region["bbox"], parent: string | null = null, extra: Partial<Region> = {}): Region =>
  ({ id, kind, bbox, parent, evidence: [], confidence: 0.9, source: "vector", ...extra });

// A 2000 × 1000 px sheet: right-edge title block, two details in the drawing area.
const sheet = (): SheetRegions => ({
  key: "set.pdf#3", w: 2000, h: 1000, group: "g1",
  regions: [
    R("tb", "title_block", [1700, 0, 2000, 1000]),
    R("firm", "firm", [1700, 0, 2000, 200], "tb", { label: "ACME ARCHITECTS" }),
    R("sid", "sheet_id", [1700, 800, 2000, 1000], "tb"),
    R("da", "drawing_area", [0, 0, 1700, 1000]),
    R("d1", "detail", [0, 0, 850, 1000], "da", { detail: { number: "3", sheet_ref: "A-501", title: "ENLARGED TOILET PLAN", scale: "1/4\" = 1'-0\"" } }),
    R("d2", "detail", [850, 0, 1700, 500], "da", { detail: { number: "4" } }),
    R("kn", "keynotes", [900, 50, 1200, 300], "da"),
  ],
});

// ── kinds ───────────────────────────────────────────────────────────────────

test("every kind's parent is a top-level kind", () => {
  for (const k of REGION_KINDS) {
    const p = REGION_PARENT[k];
    if (p !== null) assert.equal(REGION_PARENT[p as keyof typeof REGION_PARENT], null, k);
  }
});

// ── lookup ──────────────────────────────────────────────────────────────────

test("regionAt: the deepest region wins", () => {
  assert.equal(regionAt(sheet(), 1800, 100)?.id, "firm");
  assert.equal(regionAt(sheet(), 1800, 500)?.id, "tb"); // title block, no part
  assert.equal(regionAt(sheet(), 100, 100)?.id, "d1");
});

test("regionAt: same depth — the smaller region wins", () => {
  // keynotes sit inside detail 4's box; both are children of the drawing area
  assert.equal(regionAt(sheet(), 1000, 100)?.id, "kn");
});

test("regionAt: nothing contains the point → null", () => {
  assert.equal(regionAt(sheet(), 5000, 5000), null);
  assert.equal(regionAt({ key: "x", w: 1, h: 1, regions: [] }, 0, 0), null);
});

test("regionPath: root first", () => {
  assert.deepEqual(regionPath(sheet(), "firm").map((r) => r.id), ["tb", "firm"]);
  assert.deepEqual(regionPath(sheet(), "missing"), []);
});

test("regionLabel: details read their title, others their label or kind", () => {
  const s = sheet();
  const get = (id: string) => s.regions.find((r) => r.id === id)!;
  assert.equal(regionLabel(get("d1")), "Detail 3 – ENLARGED TOILET PLAN");
  assert.equal(regionLabel(get("d2")), "Detail 4");
  assert.equal(regionLabel(get("firm")), "Firm – ACME ARCHITECTS");
  assert.equal(regionLabel(get("sid")), "Sheet ID");
});

test("hitRegion: drawing area drops out of the path under something specific", () => {
  const h = hitRegion(sheet(), 100, 100)!;
  assert.equal(h.kind, "detail");
  assert.deepEqual(h.path, ["Detail 3 – ENLARGED TOILET PLAN"]);
  assert.equal(h.detail?.sheet_ref, "A-501");
  assert.equal(formatHitRegion("A-501", h), "A-501 › Detail 3 – ENLARGED TOILET PLAN");
  const t = hitRegion(sheet(), 1800, 100)!;
  assert.deepEqual(t.path, ["Title block", "Firm – ACME ARCHITECTS"]);
});

test("hitRegion: the bare drawing area still reports itself", () => {
  const s = sheet();
  s.regions = s.regions.filter((r) => r.parent !== "da");
  assert.deepEqual(hitRegion(s, 100, 100)?.path, ["Drawing area"]);
});

test("hitRegion: no map → null (callers show nothing, not a guess)", () => {
  assert.equal(hitRegion(null, 1, 1), null);
  assert.equal(hitRegion(undefined, 1, 1), null);
});

// ── cleanRegions ────────────────────────────────────────────────────────────

test("cleanRegions: keeps a valid tree unchanged, in any input order", () => {
  const s = sheet();
  const shuffled = [...s.regions].reverse();
  const out = cleanRegions(shuffled);
  assert.equal(out.length, s.regions.length);
  for (const r of s.regions) assert.deepEqual(out.find((o) => o.id === r.id), r);
});

test("cleanRegions: drops malformed entries, unknown kinds, zero-area boxes, duplicate ids", () => {
  const out = cleanRegions([
    null, 42, { id: "x" },
    R("a", "title_block", [0, 0, 10, 10]),
    { ...R("b", "title_block", [0, 0, 10, 10]), kind: "banana" },
    R("c", "drawing_area", [5, 5, 5, 50]),
    R("a", "drawing_area", [0, 0, 10, 10]),
    { ...R("d", "drawing_area", [0, 0, 10, 10]), bbox: [0, 0, NaN, 10] },
  ]);
  assert.deepEqual(out.map((r) => r.id), ["a"]);
});

test("cleanRegions: a flipped bbox is normalized", () => {
  assert.deepEqual(cleanRegions([R("a", "drawing_area", [10, 20, 0, 0])])[0].bbox, [0, 0, 10, 20]);
});

test("cleanRegions: parents must exist, be the right kind, and hold the child", () => {
  const out = cleanRegions([
    R("tb", "title_block", [100, 0, 200, 100]),
    R("da", "drawing_area", [0, 0, 100, 100]),
    R("orphan", "firm", [100, 0, 200, 50], "nope"),
    R("wrongparent", "firm", [100, 0, 200, 50], "da"),  // firm belongs in a title block
    R("toplevel-with-parent", "title_block", [100, 0, 200, 100], "da"),
    R("nochild-parent", "detail", [0, 0, 50, 50]),        // detail needs a parent
    R("outside", "firm", [300, 0, 400, 50], "tb"),       // no overlap with its parent
    R("clipped", "firm", [150, -50, 250, 50], "tb"),     // half out
  ]);
  assert.deepEqual(out.map((r) => r.id).sort(), ["clipped", "da", "tb"]);
  assert.deepEqual(out.find((r) => r.id === "clipped")!.bbox, [150, 0, 200, 50]);
});

test("cleanRegions: a parent cycle never survives", () => {
  const out = cleanRegions([
    R("da", "drawing_area", [0, 0, 100, 100]),
    R("a", "detail", [0, 0, 10, 10], "b"),
    R("b", "detail", [0, 0, 10, 10], "a"),
  ]);
  assert.deepEqual(out.map((r) => r.id), ["da"]);
});

test("cleanRegions: clamps confidence, fills evidence, defaults the source", () => {
  const [r] = cleanRegions([{ id: "a", kind: "drawing_area", bbox: [0, 0, 1, 1], parent: null, confidence: 7, source: "magic" }]);
  assert.equal(r.confidence, 1);
  assert.deepEqual(r.evidence, []);
  assert.equal(r.source, "vector");
});

// ── persistence ─────────────────────────────────────────────────────────────

test("setSignature: order-independent, changes when any file is re-read", () => {
  const a = setSignature([{ file: "a.pdf", builtAt: 1 }, { file: "b.pdf", builtAt: 2 }]);
  assert.equal(a, setSignature([{ file: "b.pdf", builtAt: 2 }, { file: "a.pdf", builtAt: 1 }]));
  assert.notEqual(a, setSignature([{ file: "a.pdf", builtAt: 1 }, { file: "b.pdf", builtAt: 3 }]));
  assert.notEqual(a, setSignature([{ file: "a.pdf", builtAt: 1 }]));
});

test("serialize → sanitize round-trips", () => {
  const s = sheet();
  const sig = setSignature([{ file: "set.pdf", builtAt: 5 }]);
  const stored = JSON.parse(JSON.stringify(serializeRegionMap(new Map([[s.key, s]]), sig)));
  assert.equal(stored.schema, REGION_MAP_SCHEMA);
  assert.equal(stored.detector, REGION_DETECTOR_VERSION);
  const back = sanitizeRegionMap(stored, sig);
  assert.deepEqual(back.get(s.key), s);
});

test("sanitizeRegionMap: another schema, detector or set drops everything", () => {
  const s = sheet();
  const stored = serializeRegionMap(new Map([[s.key, s]]), "sig");
  assert.equal(sanitizeRegionMap({ ...stored, schema: "x" }, "sig").size, 0);
  assert.equal(sanitizeRegionMap({ ...stored, detector: REGION_DETECTOR_VERSION + 1 }, "sig").size, 0);
  assert.equal(sanitizeRegionMap(stored, "other").size, 0);
  assert.equal(sanitizeRegionMap(null, "sig").size, 0);
  assert.equal(sanitizeRegionMap("junk", "sig").size, 0);
});

test("sanitizeRegionMap: bad sheets are dropped one by one", () => {
  const s = sheet();
  const stored = { ...serializeRegionMap(new Map([[s.key, s]]), "sig") };
  stored.sheets = [...stored.sheets, { key: "", w: 1, h: 1, regions: [] }, { key: "z", w: 0, h: 1, regions: [] }, { key: s.key, w: 9, h: 9, regions: [] }] as SheetRegions[];
  const back = sanitizeRegionMap(stored, "sig");
  assert.deepEqual([...back.keys()], [s.key]);
  assert.equal(back.get(s.key)!.w, 2000); // first entry for a key wins
});

// ── corrections ─────────────────────────────────────────────────────────────

const setMap = (...ss: SheetRegions[]) => new Map(ss.map((s) => [s.key, s]));
/** applyOverrides on a one-sheet map. */
const apply1 = (s: SheetRegions, ov: RegionOverrides) => applyOverrides(setMap(s), ov).get(s.key)!;
/** The fixture sheet with a signature, and a template made for it. */
const signed = (): SheetRegions => ({ ...sheet(), group_sig: SIG() });

const tplRegions = [
  R("u:tb", "title_block", [0, 0.9, 1, 1]),   // bottom strip
  R("u:firm", "firm", [0, 0.9, 0.3, 1], "u:tb", { label: "ACME" }),
];

test("sanitizeRegionOverrides: keeps valid parts, marks them user, drops the rest", () => {
  const ov = sanitizeRegionOverrides({
    groups: {
      g1: { source_sheet: "set.pdf", group_sig: { ...SIG(), statics: ["  X  ", "Y".repeat(90)] }, regions: [...tplRegions, R("u:d", "drawing_area", [0, 0, 1, 0.9])] },
      g4: { source_sheet: "set.pdf", group_sig: { edge: "middle", d: 0.1 }, regions: tplRegions }, // bad signature → kept without one
      g2: { source_sheet: "", regions: tplRegions },            // no source → dropped
      g3: { source_sheet: "x", regions: [R("big", "title_block", [0, 0, 2, 1])] }, // not normalized
    },
    sheet_group: { "a.pdf": "g1", "b.pdf": 3, "c.pdf": { group: "g1", sig: SIG() }, "d.pdf": { group: "g1" } },
    sheets: { "set.pdf#3": { removed: ["d2", "d2", 5], regions: [R("u:n", "general_notes", [0.1, 0.1, 0.2, 0.2], "da")] }, empty: {} },
    junk: true,
  });
  assert.deepEqual(Object.keys(ov.groups!), ["g1", "g4"]);
  assert.deepEqual(ov.groups!.g1.group_sig!.statics, ["Y".repeat(80), "X"]); // capped
  assert.equal(ov.groups!.g4.group_sig, undefined);
  assert.deepEqual(ov.groups!.g1.regions.map((r) => r.id), ["u:tb", "u:firm"]); // drawing area isn't template material
  assert.ok(ov.groups!.g1.regions.every((r) => r.source === "user" && r.confidence === 1));
  assert.deepEqual(ov.sheet_group, { "c.pdf": { group: "g1", sig: SIG() } }); // the old string form is dropped
  assert.deepEqual(ov.sheets!["set.pdf#3"].removed, ["d2"]);
  assert.equal(ov.sheets!["set.pdf#3"].regions![0].parent, "da"); // may hang off a detected parent
  assert.equal(ov.sheets!.empty, undefined);
  assert.deepEqual(sanitizeRegionOverrides(null), {});
  assert.deepEqual(sanitizeRegionOverrides([1, 2]), {});
});

test("applyOverrides: no corrections → same regions", () => {
  assert.deepEqual(apply1(sheet(), {}).regions, sheet().regions);
});

test("applyOverrides: a group template replaces the whole detected title block", () => {
  const ov = sanitizeRegionOverrides({ groups: { g1: { source_sheet: "set.pdf", group_sig: SIG(), regions: tplRegions } } });
  const out = apply1(signed(), ov);
  const ids = out.regions.map((r) => r.id);
  for (const gone of ["tb", "firm", "sid"]) assert.ok(!ids.includes(gone), gone);
  const tb = out.regions.find((r) => r.id === "u:tb")!;
  assert.deepEqual(tb.bbox, [0, 900, 2000, 1000]); // projected to this sheet's px
  // only title-block kinds are replaced; the drawing area's regions stay
  assert.ok(ids.includes("d1") && ids.includes("kn"));
  assert.equal(regionAt(out, 100, 950)?.id, "u:firm");
});

test("applyOverrides: a manual group move outranks the detected group", () => {
  const other = SIG({ edge: "right", statics: ["OTHER FIRM"] });
  const map = setMap(signed(), { key: "other.pdf", w: 2000, h: 1000, group: "g2", group_sig: other, regions: [] });
  const ov = sanitizeRegionOverrides({
    groups: { g2: { source_sheet: "other.pdf", group_sig: other, regions: tplRegions } },
    sheet_group: { "set.pdf#3": { group: "g2", sig: other } },
  });
  assert.equal(groupOf(map, ov, "set.pdf#3"), "g2");
  const out = applyOverrides(map, ov).get("set.pdf#3")!;
  assert.equal(out.group, "g2");
  assert.deepEqual(out.group_sig, other);
  assert.ok(out.regions.some((r) => r.id === "u:tb"));
});

test("applyOverrides: removing a region removes its children", () => {
  const out = apply1(sheet(), { sheets: { "set.pdf#3": { removed: ["tb"] } } });
  const ids = out.regions.map((r) => r.id);
  assert.ok(!ids.includes("tb") && !ids.includes("firm") && !ids.includes("sid"));
  assert.ok(ids.includes("da"));
});

test("applyOverrides: added regions land in px and join the tree", () => {
  const s = sheet();
  const bbox = toNormBbox([100, 600, 400, 900], s.w, s.h);
  const ov = sanitizeRegionOverrides({ sheets: { [s.key]: { regions: [R("u:gn", "general_notes", bbox, "d1")] } } });
  // general notes must sit under the drawing area, not a detail → rejected
  assert.ok(!apply1(s, ov).regions.some((r) => r.id === "u:gn"));
  const ok = sanitizeRegionOverrides({ sheets: { [s.key]: { regions: [R("u:gn", "general_notes", bbox, "da")] } } });
  const out = apply1(s, ok);
  const gn = out.regions.find((r) => r.id === "u:gn")!;
  assert.deepEqual(gn.bbox.map(Math.round), [100, 600, 400, 900]);
  assert.equal(gn.source, "user");
});

test("applyOverrides: an added region with a detected id replaces it", () => {
  const s = sheet();
  const ov = sanitizeRegionOverrides({ sheets: { [s.key]: { regions: [R("d2", "detail", [0.425, 0, 0.85, 0.6], "da", { detail: { number: "4", title: "FIXED" } })] } } });
  const d2 = apply1(s, ov).regions.find((r) => r.id === "d2")!;
  assert.equal(d2.detail?.title, "FIXED");
  assert.equal(d2.source, "user");
  assert.deepEqual(d2.bbox, [850, 0, 1700, 600]);
});

// ── group signature and ids ─────────────────────────────────────────────────

const SIG = (extra: Partial<GroupSig> = {}): GroupSig =>
  ({ edge: "bottom", d: 0.12, aspect: aspectBucket(3600, 2400), statics: ["VA MEDICAL CENTER", "ACME ARCHITECTS"], ...extra });

test("aspectBucket: w/h to 0.02", () => {
  assert.equal(aspectBucket(3600, 2400), 1.5);
  assert.equal(aspectBucket(3601, 2400), 1.5);
  assert.equal(aspectBucket(1100, 850), 1.3);   // letter landscape, 1.294…
  assert.equal(aspectBucket(1224, 792), 1.54);  // ANSI B, 1.545…
});

test("capStatics: longest first, then lexicographic; at most 20 × 80 chars", () => {
  assert.deepEqual(capStatics(["B", "AA", "A", "  ", "C", "B", "AAA"]), ["AAA", "AA", "A", "B", "C"]);
  const long = "X".repeat(200);
  assert.equal(capStatics([long])[0].length, 80);
  const many = Array.from({ length: 30 }, (_, i) => `S${String(i).padStart(2, "0")}${"y".repeat(i % 3)}`);
  const out = capStatics(many);
  assert.equal(out.length, 20);
  assert.deepEqual(out, capStatics([...many].reverse())); // any input order → same choice
  // the 20 kept are the longest ones
  assert.ok(out.every((s) => s.length >= out[out.length - 1].length));
});

test("assignGroupIds: g: + a short hash of the signature, deterministic", () => {
  const [a] = assignGroupIds([{ sig: SIG(), keys: ["s.pdf#1"] }]);
  assert.match(a, /^g:[0-9a-f]{8}$/);
  // same signature → same id, whatever the statics' order or the members
  const [b] = assignGroupIds([{ sig: SIG({ statics: ["ACME ARCHITECTS", "VA MEDICAL CENTER"] }), keys: ["other.pdf#9"] }]);
  assert.equal(a, b);
  // anything in the signature changes it
  for (const change of [{ edge: "right" as const }, { d: 0.13 }, { aspect: 1.3 }, { page_in: [36, 24] as [number, number] }, { statics: ["ACME ARCHITECTS"] }]) {
    assert.notEqual(assignGroupIds([{ sig: SIG(change), keys: ["s.pdf#1"] }])[0], a, JSON.stringify(change));
  }
});

test("assignGroupIds: equal signatures get -1, -2 … by smallest member key; ids unique", () => {
  const free = SIG({ statics: [], page_in: [11, 8.5] });  // two letter-size sketches
  const clusters = [
    { sig: SIG(), keys: ["s.pdf#3", "s.pdf#2"] },
    { sig: free, keys: ["sk.pdf#2"] },
    { sig: SIG({ edge: "right" }), keys: ["s.pdf#1"] },
    { sig: free, keys: ["sk.pdf#1", "sk.pdf#5"] },
  ];
  const ids = assignGroupIds(clusters);
  assert.equal(new Set(ids).size, ids.length);
  assert.match(ids[0], /^g:[0-9a-f]{8}$/); // a unique signature has no suffix
  assert.equal(ids[3], ids[1].replace(/-2$/, "-1"));
  assert.match(ids[3], /-1$/);   // sk.pdf#1 < sk.pdf#2
  assert.match(ids[1], /-2$/);
  // input order doesn't matter
  const again = assignGroupIds([...clusters].reverse()).reverse();
  assert.deepEqual(again, ids);
});

test("SheetRegions carries its border and group signature", () => {
  const s: SheetRegions = { ...sheet(), border: [40, 30, 1960, 970], group_sig: SIG() };
  assert.deepEqual(s.border, [40, 30, 1960, 970]);
  assert.equal(s.group_sig?.edge, "bottom");
});

// ── resolving corrections by signature ──────────────────────────────────────

const ARCH = Array.from({ length: 10 }, (_, i) => `ARCH STATIC ${i}`);
const archSig = SIG({ statics: ARCH, page_in: [36, 24] });
const coverSig = SIG({ statics: [], page_in: [36, 24] }); // the architect's geometry, no statics
const on = (key: string, group: string, sig: GroupSig): SheetRegions => ({ ...sheet(), key, group, group_sig: sig });
const tpl = (sig: GroupSig | undefined, source = "s.pdf#2") => ({ source_sheet: source, ...(sig ? { group_sig: sig } : {}), regions: tplRegions });
const baseMap = () => setMap(on("s.pdf#1", "g:cover", coverSig), on("s.pdf#2", "g:arch", archSig), on("s.pdf#3", "g:arch", archSig));

test("mapGroups: one entry per group, with its signature and members", () => {
  const g = mapGroups(baseMap());
  assert.deepEqual([...g.keys()].sort(), ["g:arch", "g:cover"]);
  assert.deepEqual(g.get("g:arch")!.members, ["s.pdf#2", "s.pdf#3"]);
  assert.equal(g.get("g:cover")!.sig, coverSig);
});

test("matchGroup: geometry must agree — edge, aspect bucket, |Δd| ≤ 1.5%, page size when both know it", () => {
  const groups = mapGroups(setMap(on("a", "g:a", archSig)));
  assert.deepEqual(matchGroup(archSig, groups), { group: "g:a", score: 1 });
  assert.equal(matchGroup({ ...archSig, d: archSig.d + 0.014 }, groups).group, "g:a");
  assert.equal(matchGroup({ ...archSig, page_in: undefined }, groups).group, "g:a"); // unknown on one side: no test
  for (const bad of [{ edge: "right" as const }, { aspect: 1.3 }, { d: archSig.d + 0.016 }, { page_in: [42, 30] as [number, number] }]) {
    assert.deepEqual(matchGroup({ ...archSig, ...bad }, groups), { group: null, reason: "no-match" }, JSON.stringify(bad));
  }
});

test("matchGroup: one-string reissue still matches", () => {
  const reissued = [...ARCH.slice(0, 9), "ARCH STATIC REV 2"];
  const m = matchGroup(archSig, mapGroups(setMap(on("a", "g:new", { ...archSig, statics: reissued }))));
  assert.equal(m.group, "g:new");
  assert.ok(m.group && Math.abs(m.score - 9 / 11) < 1e-9);
});

test("matchGroup: added sheets changing the statics still match", () => {
  const grown = [...ARCH, "NEW 1", "NEW 2", "NEW 3"];
  assert.equal(matchGroup(archSig, mapGroups(setMap(on("a", "g:a", { ...archSig, statics: grown })))).group, "g:a");
});

test("matchGroup: Jaccard below 0.5 → no-match", () => {
  const other = [...ARCH.slice(0, 4), ...Array.from({ length: 6 }, (_, i) => `OTHER ${i}`)]; // 4/16
  assert.deepEqual(matchGroup(archSig, mapGroups(setMap(on("a", "g:a", { ...archSig, statics: other })))), { group: null, reason: "no-match" });
});

test("matchGroup: two groups sharing boilerplate — a tie is ambiguous, a clear lead matches", () => {
  const boiler = Array.from({ length: 6 }, (_, i) => `VA FORM ${i}`);
  const A = [...boiler, "FIRM A1", "FIRM A2", "FIRM A3", "FIRM A4"];
  const B = [...boiler, "FIRM B1", "FIRM B2", "FIRM B3", "FIRM B4"];
  const groups = mapGroups(setMap(on("a", "g:a", { ...archSig, statics: A }), on("b", "g:b", { ...archSig, statics: B })));
  assert.deepEqual(matchGroup({ ...archSig, statics: boiler }, groups), { group: null, reason: "ambiguous" }); // 0.6 vs 0.6
  const m = matchGroup({ ...archSig, statics: [...boiler, "FIRM A1", "FIRM A2"] }, groups);                    // 0.8 vs 0.5
  assert.equal(m.group, "g:a");
});

test("matchGroup: a template with statics never matches a statics-free group", () => {
  const groups = mapGroups(setMap(on("a", "g:a", coverSig)));
  assert.deepEqual(matchGroup(archSig, groups, "a"), { group: null, reason: "no-match" });
});

test("matchGroup: statics-free template — anchored by its source sheet", () => {
  assert.deepEqual(matchGroup(coverSig, mapGroups(baseMap()), "s.pdf#1"), { group: "g:cover", score: 1 });
  // the source sheet anchors even when the page size is unknown
  assert.equal(matchGroup({ ...coverSig, page_in: undefined }, mapGroups(baseMap()), "s.pdf#1").group, "g:cover");
});

test("matchGroup: statics-free template — cover removed → not sent to the architect group", () => {
  const map = setMap(on("s.pdf#2", "g:arch", archSig), on("s.pdf#3", "g:arch", archSig));
  assert.deepEqual(matchGroup(coverSig, mapGroups(map), "s.pdf#1"), { group: null, reason: "no-match" });
});

test("matchGroup: statics-free template — cover replaced by an architect group → not applied", () => {
  // the cover now carries the shared title block; a same-size statics-free
  // sketch would pass the page-size test alone, but the source sheet wins
  const map = setMap(on("s.pdf#1", "g:arch", archSig), on("s.pdf#2", "g:arch", archSig), on("sk.pdf#1", "g:sk", coverSig));
  assert.deepEqual(matchGroup(coverSig, mapGroups(map), "s.pdf#1"), { group: null, reason: "no-match" });
});

test("matchGroup: statics-free template — page size anchors exactly one group; two → ambiguous; unknown → no-anchor", () => {
  const letter = SIG({ statics: [], page_in: [11, 8.5], aspect: aspectBucket(11, 8.5) });
  const one = mapGroups(setMap(on("sk.pdf#1", "g:sk1", letter), on("s.pdf#2", "g:arch", archSig)));
  assert.deepEqual(matchGroup(letter, one, "gone.pdf#1"), { group: "g:sk1", score: 1 });
  const two = mapGroups(setMap(on("sk.pdf#1", "g:sk-1", letter), on("sk.pdf#2", "g:sk-2", letter)));
  assert.deepEqual(matchGroup(letter, two, "gone.pdf#1"), { group: null, reason: "ambiguous" });
  assert.deepEqual(matchGroup({ ...letter, page_in: undefined }, one, "gone.pdf#1"), { group: null, reason: "no-anchor" });
  const unknownGroup = mapGroups(setMap(on("sk.pdf#1", "g:sk1", { ...letter, page_in: undefined })));
  assert.deepEqual(matchGroup(letter, unknownGroup, "gone.pdf#1"), { group: null, reason: "no-anchor" });
  // the source sheet still anchors when there are two
  assert.equal(matchGroup(letter, two, "sk.pdf#2").group, "g:sk-2");
});

test("resolveOverrides: templates resolve by signature; the id is only a hint", () => {
  const map = setMap(on("s.pdf#2", "g:renamed", archSig));
  const r = resolveOverrides(map, { groups: { "g:arch": tpl(archSig) } });
  assert.deepEqual(r.templates, { "g:arch": { group: "g:renamed", score: 1 } });
  assert.deepEqual(r.unattached, []);
});

test("resolveOverrides: id present but signature changed → not applied", () => {
  const map = setMap(on("s.pdf#2", "g:arch", { ...archSig, edge: "right" }));
  const ov: RegionOverrides = { groups: { "g:arch": tpl(archSig) } };
  const r = resolveOverrides(map, ov);
  assert.deepEqual(r.templates, {});
  assert.deepEqual(r.unattached, [{ kind: "template", key: "g:arch", reason: "no-match" }]);
  assert.ok(applyOverrides(map, ov).get("s.pdf#2")!.regions.some((r) => r.id === "tb")); // detected title block stays
});

test("resolveOverrides: a template without a signature is kept but never applied (no-sig)", () => {
  const ov = sanitizeRegionOverrides({ groups: { "g:arch": { source_sheet: "s.pdf#2", regions: tplRegions } } });
  assert.ok(ov.groups!["g:arch"]);
  const r = resolveOverrides(baseMap(), ov);
  assert.deepEqual(r.unattached, [{ kind: "template", key: "g:arch", reason: "no-sig" }]);
  assert.ok(!applyOverrides(baseMap(), ov).get("s.pdf#2")!.regions.some((r) => r.id === "u:tb"));
});

test("resolveOverrides: two templates on one group — higher score, then smaller |Δd|, tie → neither (conflict)", () => {
  const map = baseMap();
  const near = { ...archSig, statics: ARCH.slice(0, 9) };           // 0.9
  const far = { ...archSig, statics: ARCH.slice(0, 8) };            // 0.8
  let r = resolveOverrides(map, { groups: { t1: tpl(far), t2: tpl(near) } });
  assert.deepEqual(r.templates, { t2: { group: "g:arch", score: 0.9 } });
  assert.deepEqual(r.unattached, [{ kind: "template", key: "t1", reason: "conflict" }]);
  r = resolveOverrides(map, { groups: { t1: tpl({ ...archSig, d: archSig.d + 0.01 }), t2: tpl({ ...archSig, d: archSig.d - 0.005 }) } });
  assert.deepEqual(Object.keys(r.templates), ["t2"]);
  r = resolveOverrides(map, { groups: { t1: tpl({ ...archSig, d: archSig.d + 0.01 }), t2: tpl({ ...archSig, d: archSig.d - 0.01 }) } });
  assert.deepEqual(r.templates, {});
  assert.deepEqual(r.unattached, [{ kind: "template", key: "t1", reason: "conflict" }, { kind: "template", key: "t2", reason: "conflict" }]);
});

test("resolveOverrides: a move resolves its target by signature; a failed move leaves the sheet where it was", () => {
  const map = baseMap();
  const moved = resolveOverrides(map, { sheet_group: { "s.pdf#1": { group: "g:old-id", sig: archSig } } });
  assert.deepEqual(moved.moves, { "s.pdf#1": "g:arch" });
  assert.equal(groupOf(map, { sheet_group: { "s.pdf#1": { group: "g:old-id", sig: archSig } } }, "s.pdf#1"), "g:arch");
  const lost = { sheet_group: { "s.pdf#1": { group: "g:arch", sig: { ...archSig, edge: "left" as const } } } };
  const r = resolveOverrides(map, lost);
  assert.deepEqual(r.moves, {});
  assert.deepEqual(r.unattached, [{ kind: "move", key: "s.pdf#1", reason: "no-match" }]);
  assert.equal(groupOf(map, lost, "s.pdf#1"), "g:cover");
});

test("applyOverrides: uses the resolver and never writes", () => {
  const map = baseMap();
  const ov = sanitizeRegionOverrides({
    groups: { "g:stale": { ...tpl(archSig) } },
    sheet_group: { "s.pdf#1": { group: "g:arch", sig: archSig } },
  });
  const before = JSON.stringify([[...map], ov]);
  const out = applyOverrides(map, ov);
  assert.equal(JSON.stringify([[...map], ov]), before);
  assert.equal(out.get("s.pdf#1")!.group, "g:arch");             // moved, and picks up the template
  assert.ok(out.get("s.pdf#1")!.regions.some((r) => r.id === "u:tb"));
  assert.ok(out.get("s.pdf#3")!.regions.some((r) => r.id === "u:tb"));
});

test("resolveOverrides: two letter-size sketches — page-size anchor is ambiguous, no page size is no-anchor", () => {
  const letter = SIG({ statics: [], page_in: [11, 8.5], aspect: aspectBucket(11, 8.5) });
  const map = setMap(on("sk.pdf#1", "g:sk-1", letter), on("sk.pdf#2", "g:sk-2", letter), on("s.pdf#2", "g:arch", archSig));
  const r = resolveOverrides(map, { groups: {
    "g:sk-1": tpl(letter, "gone.pdf#1"),
    "g:sk-2": tpl({ ...letter, page_in: undefined }, "gone.pdf#2"),
  } });
  assert.deepEqual(r.templates, {});
  assert.deepEqual(r.unattached, [
    { kind: "template", key: "g:sk-1", reason: "ambiguous" },
    { kind: "template", key: "g:sk-2", reason: "no-anchor" },
  ]);
});

// ── drawing area after a template ───────────────────────────────────────────

const tplOn = (tb: Region["bbox"]): RegionOverrides =>
  sanitizeRegionOverrides({ groups: { g1: { source_sheet: "set.pdf#3", group_sig: SIG(), regions: [R("u:tb", "title_block", tb)] } } });
const daOf = (s: SheetRegions) => s.regions.find((r) => r.kind === "drawing_area");

test("applyOverrides: template on a different edge — the old strip's area returns to the drawing area", () => {
  const out = apply1(signed(), tplOn([0, 0.9, 1, 1]));  // bottom strip; detected was right
  assert.deepEqual(daOf(out)!.bbox, [0, 0, 2000, 900]); // no border → the full sheet
  assert.equal(daOf(out)!.id, "da");                    // the detected id stays, so its children keep their parent
  assert.equal(regionAt(out, 1800, 100)?.id, "da");     // was the detected title block
  assert.deepEqual(out.regions.find((r) => r.id === "d1")!.bbox, [0, 0, 850, 900]); // clipped to the new drawing area
});

test("applyOverrides: template on the same edge with a different d — rebuilt from the border box", () => {
  const s = { ...signed(), border: [40, 30, 1960, 970] as Region["bbox"] };
  const out = apply1(s, tplOn([0.8, 0, 1, 1]));         // right strip reaching the page edge
  assert.deepEqual(daOf(out)!.bbox, [40, 30, 1600, 970]);
  assert.deepEqual(out.regions.find((r) => r.id === "d2")!.bbox, [850, 30, 1600, 500]);
  assert.equal(out.regions.find((r) => r.id === "kn")!.bbox[2], 1200);
});

test("applyOverrides: the strip's edge is the border side it touches", () => {
  const s = { ...signed(), border: [40, 30, 1960, 970] as Region["bbox"] };
  // drawn from border to border, slightly inside the border on the outer side
  assert.deepEqual(daOf(apply1(s, tplOn([0.02, 0.02, 0.2, 0.97])))!.bbox, [400, 30, 1960, 970]); // left
  assert.deepEqual(daOf(apply1(s, tplOn([0.02, 0.03, 0.98, 0.15])))!.bbox, [40, 150, 1960, 970]); // top
});

test("applyOverrides: a template adds a drawing area when none was detected", () => {
  const s = { ...signed(), regions: sheet().regions.filter((r) => r.kind === "title_block" || r.parent === "tb") };
  const out = apply1(s, tplOn([0, 0.9, 1, 1]));
  assert.deepEqual(daOf(out)!.bbox, [0, 0, 2000, 900]);
  assert.equal(daOf(out)!.source, "user");
});

// ── clamping and map sanitizers ─────────────────────────────────────────────

test("cleanRegions: with dims, top-level regions are clamped to the sheet; children follow", () => {
  const out = cleanRegions([
    R("tb", "title_block", [1700, -20, 2100, 1000]),
    R("firm", "firm", [1700, -20, 2100, 200], "tb"),
    R("da", "drawing_area", [-10, 0, 1700, 1000]),
    R("off", "drawing_area", [2100, 0, 2300, 100]),    // entirely off the sheet
  ], { w: 2000, h: 1000 });
  assert.deepEqual(out.map((r) => [r.id, r.bbox]), [
    ["tb", [1700, 0, 2000, 1000]], ["firm", [1700, 0, 2000, 200]], ["da", [0, 0, 1700, 1000]],
  ]);
});

test("cleanRegions: without dims nothing is clamped", () => {
  assert.deepEqual(cleanRegions([R("da", "drawing_area", [-10, 0, 2100, 1000])])[0].bbox, [-10, 0, 2100, 1000]);
});

test("applyOverrides: the sheet's dims clamp the result", () => {
  const s = sheet();
  s.regions = s.regions.map((r) => (r.id === "da" ? { ...r, bbox: [-50, 0, 1700, 1100] as Region["bbox"] } : r));
  assert.deepEqual(apply1(s, {}).regions.find((r) => r.id === "da")!.bbox, [0, 0, 1700, 1000]);
});

test("sanitizeRegionMap: border and group_sig round-trip; regions are clamped to the sheet", () => {
  const s: SheetRegions = { ...sheet(), border: [40, 30, 1960, 970], group_sig: { ...SIG(), page_in: [36, 24] } };
  s.regions = s.regions.map((r) => (r.id === "tb" ? { ...r, bbox: [1700, 0, 2050, 1000] as Region["bbox"] } : r));
  const back = sanitizeRegionMap(JSON.parse(JSON.stringify(serializeRegionMap(new Map([[s.key, s]]), "sig"))), "sig").get(s.key)!;
  assert.deepEqual(back.border, [40, 30, 1960, 970]);
  assert.deepEqual(back.group_sig, s.group_sig);
  assert.deepEqual(back.regions.find((r) => r.id === "tb")!.bbox, [1700, 0, 2000, 1000]);
});

test("sanitizeRegionMap: a bad border or group_sig is dropped; statics are capped", () => {
  const base = { ...sheet(), key: "a" };
  const sheets = [
    { ...base, key: "a", border: [0, 0, "x", 1], group_sig: { ...SIG(), edge: "middle" } },
    { ...base, key: "b", border: [-100, -100, 3000, 900], group_sig: { ...SIG(), statics: Array.from({ length: 25 }, (_, i) => `S${i}`), page_in: [0, 24] } },
    { ...base, key: "c", border: [2500, 0, 2600, 100], group_sig: { ...SIG(), d: 2 } },
  ];
  const back = sanitizeRegionMap({ ...serializeRegionMap(new Map(), "sig"), sheets }, "sig");
  assert.equal(back.get("a")!.border, undefined);
  assert.equal(back.get("a")!.group_sig, undefined);
  assert.deepEqual(back.get("b")!.border, [0, 0, 2000, 900]);         // clamped to the sheet
  assert.equal(back.get("b")!.group_sig!.statics.length, 20);
  assert.equal(back.get("b")!.group_sig!.page_in, undefined);          // a zero page size isn't a size
  assert.equal(back.get("c")!.border, undefined);                      // off the sheet
  assert.equal(back.get("c")!.group_sig, undefined);
});

// ── review fixes ────────────────────────────────────────────────────────────

test("matchGroup: page anchor — one known + one unknown-size statics-free group → ambiguous", () => {
  const known = mapGroups(setMap(on("sk.pdf#1", "g:a", coverSig), on("sk.pdf#2", "g:b", { ...coverSig, page_in: undefined })));
  assert.deepEqual(matchGroup(coverSig, known, "gone.pdf#1"), { group: null, reason: "ambiguous" });
  // exactly one passing group, but its page size is unknown → no anchor
  const lone = mapGroups(setMap(on("sk.pdf#2", "g:b", { ...coverSig, page_in: undefined })));
  assert.deepEqual(matchGroup(coverSig, lone, "gone.pdf#1"), { group: null, reason: "no-anchor" });
});
