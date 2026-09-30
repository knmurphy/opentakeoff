// Region map tests — regions.ts is pure (no DOM, no pdf.js), so it runs
// straight under node. Run with: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  regionAt, regionPath, regionLabel, hitRegion, formatHitRegion, cleanRegions,
  setSignature, serializeRegionMap, sanitizeRegionMap, sanitizeRegionOverrides,
  applyOverrides, groupOf, toNormBbox, REGION_MAP_SCHEMA, REGION_DETECTOR_VERSION, REGION_KINDS, REGION_PARENT,
  aspectBucket, capStatics, assignGroupIds,
  type Region, type SheetRegions, type GroupSig,
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

const tplRegions = [
  R("u:tb", "title_block", [0, 0.9, 1, 1]),   // bottom strip
  R("u:firm", "firm", [0, 0.9, 0.3, 1], "u:tb", { label: "ACME" }),
];

test("sanitizeRegionOverrides: keeps valid parts, marks them user, drops the rest", () => {
  const ov = sanitizeRegionOverrides({
    groups: {
      g1: { source_sheet: "set.pdf", regions: [...tplRegions, R("u:d", "drawing_area", [0, 0, 1, 0.9])] },
      g2: { source_sheet: "", regions: tplRegions },            // no source → dropped
      g3: { source_sheet: "x", regions: [R("big", "title_block", [0, 0, 2, 1])] }, // not normalized
    },
    sheet_group: { "a.pdf": "g1", "b.pdf": 3 },
    sheets: { "set.pdf#3": { removed: ["d2", "d2", 5], regions: [R("u:n", "general_notes", [0.1, 0.1, 0.2, 0.2], "da")] }, empty: {} },
    junk: true,
  });
  assert.deepEqual(Object.keys(ov.groups!), ["g1"]);
  assert.deepEqual(ov.groups!.g1.regions.map((r) => r.id), ["u:tb", "u:firm"]); // drawing area isn't template material
  assert.ok(ov.groups!.g1.regions.every((r) => r.source === "user" && r.confidence === 1));
  assert.deepEqual(ov.sheet_group, { "a.pdf": "g1" });
  assert.deepEqual(ov.sheets!["set.pdf#3"].removed, ["d2"]);
  assert.equal(ov.sheets!["set.pdf#3"].regions![0].parent, "da"); // may hang off a detected parent
  assert.equal(ov.sheets!.empty, undefined);
  assert.deepEqual(sanitizeRegionOverrides(null), {});
  assert.deepEqual(sanitizeRegionOverrides([1, 2]), {});
});

test("applyOverrides: no corrections → same regions", () => {
  assert.deepEqual(applyOverrides(sheet(), {}).regions, sheet().regions);
});

test("applyOverrides: a group template replaces the whole detected title block", () => {
  const ov = sanitizeRegionOverrides({ groups: { g1: { source_sheet: "set.pdf", regions: tplRegions } } });
  const out = applyOverrides(sheet(), ov);
  const ids = out.regions.map((r) => r.id);
  for (const gone of ["tb", "firm", "sid"]) assert.ok(!ids.includes(gone), gone);
  const tb = out.regions.find((r) => r.id === "u:tb")!;
  assert.deepEqual(tb.bbox, [0, 900, 2000, 1000]); // projected to this sheet's px
  // only title-block kinds are replaced; the drawing area's regions stay
  assert.ok(ids.includes("d1") && ids.includes("kn"));
  assert.equal(regionAt(out, 100, 950)?.id, "u:firm");
});

test("applyOverrides: a manual group move outranks the detected group", () => {
  const ov = sanitizeRegionOverrides({
    groups: { g2: { source_sheet: "other.pdf", regions: tplRegions } },
    sheet_group: { "set.pdf#3": "g2" },
  });
  assert.equal(groupOf(sheet(), ov), "g2");
  const out = applyOverrides(sheet(), ov);
  assert.equal(out.group, "g2");
  assert.ok(out.regions.some((r) => r.id === "u:tb"));
});

test("applyOverrides: removing a region removes its children", () => {
  const out = applyOverrides(sheet(), { sheets: { "set.pdf#3": { removed: ["tb"] } } });
  const ids = out.regions.map((r) => r.id);
  assert.ok(!ids.includes("tb") && !ids.includes("firm") && !ids.includes("sid"));
  assert.ok(ids.includes("da"));
});

test("applyOverrides: added regions land in px and join the tree", () => {
  const s = sheet();
  const bbox = toNormBbox([100, 600, 400, 900], s.w, s.h);
  const ov = sanitizeRegionOverrides({ sheets: { [s.key]: { regions: [R("u:gn", "general_notes", bbox, "d1")] } } });
  // general notes must sit under the drawing area, not a detail → rejected
  assert.ok(!applyOverrides(s, ov).regions.some((r) => r.id === "u:gn"));
  const ok = sanitizeRegionOverrides({ sheets: { [s.key]: { regions: [R("u:gn", "general_notes", bbox, "da")] } } });
  const out = applyOverrides(s, ok);
  const gn = out.regions.find((r) => r.id === "u:gn")!;
  assert.deepEqual(gn.bbox.map(Math.round), [100, 600, 400, 900]);
  assert.equal(gn.source, "user");
});

test("applyOverrides: an added region with a detected id replaces it", () => {
  const s = sheet();
  const ov = sanitizeRegionOverrides({ sheets: { [s.key]: { regions: [R("d2", "detail", [0.425, 0, 0.85, 0.6], "da", { detail: { number: "4", title: "FIXED" } })] } } });
  const d2 = applyOverrides(s, ov).regions.find((r) => r.id === "d2")!;
  assert.equal(d2.detail?.title, "FIXED");
  assert.equal(d2.source, "user");
  assert.deepEqual(d2.bbox, [850, 0, 1700, 600]);
});

// ── group signature and ids ─────────────────────────────────────────────────

const SIG = (extra: Partial<GroupSig> = {}): GroupSig =>
  ({ edge: "bottom", d: 0.12, aspect: aspectBucket(3600, 2400), statics: ["ACME ARCHITECTS", "VA MEDICAL CENTER"], ...extra });

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
  const [b] = assignGroupIds([{ sig: SIG({ statics: ["VA MEDICAL CENTER", "ACME ARCHITECTS"] }), keys: ["other.pdf#9"] }]);
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
