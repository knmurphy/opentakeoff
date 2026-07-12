// Detect Rooms (vector) core tests — issue #123. The pure units (label pattern
// filter + seed transform, and the seed→flood→status-gate fan-out) are DOM-free
// and pdfjs-free, so they run straight under node. Run with: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { roomLabelSeeds, detectRegions, dedupeRegions, ROOM_LABEL_RE, type DetectedRegion } from "../src/lib/detectRooms.ts";
import { buildMask, floodRegion, SENS_BALANCED, type MaskObj } from "../src/lib/oneclick.ts";

// a closed square room, as flat boundary segments in image px
function squareSegs(x0: number, y0: number, x1: number, y1: number): number[] {
  return [x0, y0, x1, y0, x1, y0, x1, y1, x1, y1, x0, y1, x0, y1, x0, y0];
}

// ── label pattern ──────────────────────────────────────────────────────────
test("ROOM_LABEL_RE: matches 2–3 digit room numbers with an optional letter", () => {
  for (const ok of ["134", "139A", "170", "12", "99B", "100", "999Z"]) {
    assert.ok(ROOM_LABEL_RE.test(ok), `${ok} should be a room label`);
  }
  for (const no of ["1", "1234", "A134", "13.4", "13-4", "CE-5", "557SF", "", "12AB", "1a"]) {
    assert.ok(!ROOM_LABEL_RE.test(no), `${no} should NOT be a room label`);
  }
});

test("roomLabelSeeds: keeps room-number labels, drops the rest, seeds at the text-matrix origin", () => {
  // identity viewport transform ⇒ the composed origin is the item's own [e,f].
  const identity = [1, 0, 0, 1, 0, 0];
  const items = [
    { str: "134", transform: [1, 0, 0, 1, 200, 300] },     // bare room number → seed [200,300]
    { str: " 139A ", transform: [1, 0, 0, 1, 410, 260] },  // trimmed, letter suffix → seed [410,260]
    { str: "CORRIDOR", transform: [1, 0, 0, 1, 50, 50] },  // a word, no number → dropped
    { str: "1/8\"=1'-0\"", transform: [1, 0, 0, 1, 10, 10] }, // scale note → dropped
    { str: "7", transform: [1, 0, 0, 1, 0, 0] },           // single digit → dropped
    { str: "A-101", transform: [1, 0, 0, 1, 90, 90] },     // sheet number token → dropped (no plain room-number token)
  ];
  const seeds = roomLabelSeeds({ items }, identity);
  assert.deepEqual(seeds.map((s) => s.str), ["134", "139A"]);
  assert.deepEqual(seeds[0].seed, [200, 300]);
  assert.deepEqual(seeds[1].seed, [410, 260]);
});

test("roomLabelSeeds: name+number labels (the demo plan's convention) are KEPT, seeded at the item origin", () => {
  // pdf.js combines a single show-text op into ONE item, so the demo's labels
  // arrive as "OFFICE 101" / "CORRIDOR 104", not a bare "101". The number+name
  // convention (issue #81) must still detect — tokenize and keep the number.
  const identity = [1, 0, 0, 1, 0, 0];
  const items = [
    { str: "OFFICE 101", transform: [1, 0, 0, 1, 300, 250] },
    { str: "CORRIDOR 104", transform: [1, 0, 0, 1, 800, 560] },
    { str: "MECH 12", transform: [1, 0, 0, 1, 500, 500] },     // 2-digit number after a name → kept
    { str: "SEE NOTE 5", transform: [1, 0, 0, 1, 10, 10] },    // single digit → NOT a room number → dropped
  ];
  const seeds = roomLabelSeeds({ items }, identity);
  assert.deepEqual(seeds.map((s) => s.str), ["101", "104", "12"], "the room number is extracted from the combined label");
  assert.deepEqual(seeds[0].seed, [300, 250], "seed is the item's text-matrix origin, not a per-glyph offset");
});

test("roomLabelSeeds: composes the viewport transform (PDF space → device px)", () => {
  // A y-flip viewport (scale 2, height 800): device = [2x, -2y+800]. This is the
  // shape pdf.js viewport transforms take, and roomLabelSeeds must apply it so
  // the seed lands in the panel's image-px frame (not raw PDF points).
  const vpT = [2, 0, 0, -2, 0, 800];
  const seeds = roomLabelSeeds({ items: [{ str: "205", transform: [1, 0, 0, 1, 100, 300] }] }, vpT);
  assert.deepEqual(seeds[0].seed, [200, 200]);   // [2*100, -2*300+800]
});

// ── status gate + fan-out ──────────────────────────────────────────────────
// Shared clean-room fixture (mirrors geometry.test.ts): 1000×800 sheet, border +
// a 600×400 room. A seed inside floods clean (ok); a seed outside leaks; a seed
// in dense linework goes tiny.
const IMG_W = 1000, IMG_H = 800, MAXDIM = 500;
const border = squareSegs(2, 2, 998, 798);
const room = squareSegs(100, 100, 700, 500);
const zeroMeta = (segs: number[]) => new Uint8Array(segs.length >> 2);

test("detectRegions: keeps a clean-ok flood, silently drops a leak seed", () => {
  const mo = buildMask([...border, ...room], IMG_W, IMG_H, MAXDIM);
  const seeds = [
    { str: "101", seed: [400, 300] as [number, number] },   // inside the room → ok
    { str: "102", seed: [50, 50] as [number, number] },      // outside, between border and room → leaks
  ];
  const out = detectRegions(mo, seeds, SENS_BALANCED);
  assert.equal(out.length, 1, "only the enclosed room is kept; the leak is withheld");
  assert.equal(out[0].str, "101");
  assert.equal(out[0].flood.status, "ok");
});

test("detectRegions: silently drops a tiny seed (landed in dense linework)", () => {
  // A dense hatch grid with NO meta traps the strict fill between lines → tiny.
  const hatch: number[] = [];
  for (let x = 100; x <= 700; x += 4) hatch.push(x, 100, x, 500);
  const mo = buildMask([...border, ...room, ...hatch], IMG_W, IMG_H, MAXDIM); // no meta ⇒ hatch is a hard barrier
  const out = detectRegions(mo, [{ str: "134", seed: [400, 300] }], SENS_BALANCED);
  assert.equal(out.length, 0, "a tiny (dense-linework) flood is withheld");
});

test("detectRegions: a HATCH-ESCALATED room (hatchFiltered + ok) IS proposed", () => {
  // The #123-critical case: a hatch-lined room whose strict fill is trapped, but
  // the grow-but-verify escalation returns status ok WITH hatchFiltered. The gate
  // keys off STATUS, not hatchFiltered — so this real room must be kept. Same
  // fixture as geometry.test.ts's "hatched room fills to the walls" case, but
  // routed through the batch status gate.
  const hatch: number[] = [];
  for (let x = 100; x <= 700; x += 4) hatch.push(x, 100, x, 500);
  const all = [...border, ...room, ...hatch];
  const mo = buildMask(all, IMG_W, IMG_H, MAXDIM, zeroMeta(all));   // meta ⇒ hatch classifies soft
  assert.ok(mo.softCount > 100, "hatch family should classify soft");
  const out = detectRegions(mo, [{ str: "134", seed: [400, 300] }], SENS_BALANCED);
  assert.equal(out.length, 1, "the hatch-escalated room IS proposed");
  assert.equal(out[0].flood.status, "ok");
  assert.equal(out[0].flood.hatchFiltered, true, "and it is flagged as a hatch escalation (provenance, not a rejection)");
});

test("detectRegions: mixed batch — clean, hatch-escalated, and leak seeds gate correctly in one pass", () => {
  // Two rooms side by side: a clean one and a hatch-lined one, plus a leak seed.
  const roomA = squareSegs(60, 100, 300, 500);              // clean room A (240 wide)
  const roomB = squareSegs(360, 100, 700, 500);             // hatch-lined room B
  const hatchB: number[] = [];
  for (let x = 360; x <= 700; x += 4) hatchB.push(x, 100, x, 500);
  const all = [...border, ...roomA, ...roomB, ...hatchB];
  const mo = buildMask(all, IMG_W, IMG_H, MAXDIM, zeroMeta(all));
  const out = detectRegions(mo, [
    { str: "201", seed: [180, 300] },   // room A → clean ok, no hatch
    { str: "202", seed: [530, 300] },   // room B → hatch-escalated ok
    { str: "203", seed: [330, 300] },   // in the wall gap between rooms → leaks/tiny, dropped
  ], SENS_BALANCED);
  const byStr = Object.fromEntries(out.map((r) => [r.str, r.flood]));
  assert.ok(byStr["201"] && byStr["201"].status === "ok" && !byStr["201"].hatchFiltered, "room A: clean ok");
  assert.ok(byStr["202"] && byStr["202"].status === "ok" && byStr["202"].hatchFiltered, "room B: hatch-escalated ok");
  assert.ok(!byStr["203"], "the between-walls seed is withheld");
});

// ── ring-merge dedup (issue #123 follow-on) ─────────────────────────────────
// dedupeRegions collapses DUPLICATE/FRAGMENT floods that the per-seed pointInPoly
// skip misses: two seeds in ONE room (two labels), a fragment flood inside a full
// room, and concave rooms seeded twice. It compares floods by MASK-POPCOUNT
// intersection (exact at mask resolution, concave-native, order-independent),
// keeping the larger-count region per overlap cluster.

// Test-local mirror of the containment overlap (intersection / min area), so a
// fixture can assert two floods really do (or don't) overlap before checking dedup.
function containmentSanity(a: DetectedRegion, b: DetectedRegion): number {
  const ra = a.flood.region, rb = b.flood.region;
  const n = Math.min(ra.length, rb.length);
  let inter = 0;
  for (let i = 0; i < n; i++) if (ra[i] && rb[i]) inter++;
  return inter / Math.min(a.flood.count, b.flood.count);
}

// Flood a room at a given seed to get a real DetectedRegion (region buffer + count).
function detectAt(mo: MaskObj, str: string, seed: [number, number]): DetectedRegion {
  const f = floodRegion(mo, seed[0], seed[1], SENS_BALANCED);
  assert.equal(f.status, "ok", `seed ${str} @ ${seed} should flood clean`);
  return { str, seed, flood: f as Extract<typeof f, { status: "ok" }> };
}

test("dedupeRegions: two near-identical rings (one room, two labels) → ONE region, order-independent", () => {
  // One 600×400 room, TWO label seeds inside it. Each floods to (nearly) the same
  // region — the classic duplicate the pointInPoly skip misses when both seeds are
  // processed against an empty proposal in the same batch resume.
  const mo = buildMask([...border, ...room], IMG_W, IMG_H, MAXDIM);
  const a = detectAt(mo, "101", [200, 300]);
  const b = detectAt(mo, "102", [600, 200]);
  // sanity: both are the SAME room — their masks overlap almost entirely
  const fwd = dedupeRegions([a, b]);
  assert.equal(fwd.length, 1, "two seeds in one room collapse to a single region");
  const rev = dedupeRegions([b, a]);
  assert.equal(rev.length, 1, "reversed input also collapses to one");
  // order-independence: the SAME representative survives regardless of input order
  assert.equal(fwd[0].str, rev[0].str, "same representative kept in both orders");
  assert.deepEqual(fwd[0].seed, rev[0].seed, "same seed kept in both orders");
});

// Build a DetectedRegion whose region buffer is an arbitrary subset of a full
// room's flood — a "fragment flood" mostly inside the full room (e.g. a strict
// pass trapped by a partial hatch band). Shares the full room's mask geometry.
function fragmentOf(full: DetectedRegion, keepFrac: number, str: string, seed: [number, number]): DetectedRegion {
  const src = full.flood.region;
  const region = new Uint8Array(src.length);
  let count = 0;
  const target = Math.floor(full.flood.count * keepFrac);
  for (let i = 0; i < src.length && count < target; i++) if (src[i]) { region[i] = 1; count++; }
  return { str, seed, flood: { ...full.flood, region, count } };
}

test("dedupeRegions: a fragment poly mostly inside a full room → fragment dropped, full room kept", () => {
  const mo = buildMask([...border, ...room], IMG_W, IMG_H, MAXDIM);
  const full = detectAt(mo, "101", [400, 300]);
  const frag = fragmentOf(full, 0.35, "101b", [410, 310]);   // 35% of the full room, all interior cells
  assert.ok(frag.flood.count < full.flood.count, "fragment is smaller than the full room");
  for (const input of [[full, frag], [frag, full]]) {
    const out = dedupeRegions(input);
    assert.equal(out.length, 1, "fragment collapses into the full room");
    assert.equal(out[0].str, "101", "the LARGER full room is the survivor, not the fragment");
    assert.deepEqual(out[0].seed, [400, 300]);
  }
});

test("dedupeRegions: two abutting DISTINCT rooms sharing a wall → BOTH kept (no over-merge)", () => {
  // Two rooms side by side separated by a single shared wall at x=500. Their
  // interior floods share NO cells (the wall is a barrier), so containment ≈ 0.
  // This is the recall-regression guard: distinct rooms must never merge.
  const wall = squareSegs(100, 100, 500, 500);              // left room 100..500
  const wall2 = squareSegs(500, 100, 900, 500);             // right room 500..900 (shares x=500 edge)
  const mo = buildMask([...border, ...wall, ...wall2], IMG_W, IMG_H, MAXDIM);
  const left = detectAt(mo, "101", [300, 300]);
  const right = detectAt(mo, "102", [700, 300]);
  for (const input of [[left, right], [right, left]]) {
    const out = dedupeRegions(input);
    assert.equal(out.length, 2, "abutting distinct rooms are both kept");
    assert.deepEqual(new Set(out.map((r) => r.str)), new Set(["101", "102"]));
  }
});

test("dedupeRegions: a fully-walled closet nested INSIDE a larger room → BOTH kept (floodRegion recall)", () => {
  // Recall regression, driven by REAL floods (the coverage gap): a small fully-
  // walled closet sits ENTIRELY inside a larger room, so the two are separate
  // connected components. The large room's flood is blocked by the closet's walls
  // and therefore EXCLUDES the closet interior, so their masks share ~0 cells —
  // even though the closet's bbox nests inside the big room's bbox (the case a
  // naive bbox/containment heuristic would wrongly merge). dedupeRegions must keep
  // BOTH: it never drops a genuinely distinct nested room.
  const bigRoom = squareSegs(100, 100, 700, 500);            // 600×400 outer room
  const closet = squareSegs(550, 150, 650, 250);             // 100×100 walled closet inside it
  const mo = buildMask([...border, ...bigRoom, ...closet], IMG_W, IMG_H, MAXDIM);
  const big = detectAt(mo, "101", [200, 300]);               // seed in the open part of the big room
  const small = detectAt(mo, "102", [600, 200]);             // seed inside the closet
  // the big-room flood is walled off from the closet interior → near-zero overlap
  assert.ok(containmentSanity(big, small) < 0.1, "big room excludes the closet interior (separate components)");
  for (const input of [[big, small], [small, big]]) {
    const out = dedupeRegions(input);
    assert.equal(out.length, 2, "the nested closet and its enclosing room are BOTH kept");
    assert.deepEqual(new Set(out.map((r) => r.str)), new Set(["101", "102"]));
  }
});

test("dedupeRegions: mismatched region bitmap lengths (same mw/mh) fail loud, not silently truncate", () => {
  // Defensive guard for a future raster+vector mixed batch: if two regions ever
  // carried DIFFERENT bitmap lengths, intersectionCount's old Math.min would have
  // quietly compared only the shared prefix and returned a garbage overlap. We
  // construct two regions with IDENTICAL mw/mh (so the mw/mh geometry guard does
  // NOT fire) but different region.length, and assert dedupeRegions throws.
  const mo = buildMask([...border, ...room], IMG_W, IMG_H, MAXDIM);
  const a = detectAt(mo, "101", [400, 300]);
  // b: same mask geometry (mw/mh/ws), but a region buffer one cell longer.
  const longer = new Uint8Array(a.flood.region.length + 1);
  longer.set(a.flood.region);
  const b: DetectedRegion = { str: "102", seed: [410, 310], flood: { ...a.flood, region: longer } };
  assert.equal(b.flood.mw, a.flood.mw, "same mw so the geometry guard does not fire first");
  assert.equal(b.flood.mh, a.flood.mh, "same mh so the geometry guard does not fire first");
  assert.throws(() => dedupeRegions([a, b]), /length/, "mismatched bitmap lengths throw, not truncate");
  assert.throws(() => dedupeRegions([b, a]), /length/, "and in the reverse order too");
});

test("dedupeRegions: a concave (U-shaped) room seeded twice → ONE region", () => {
  // A U/concave room: a wide room with a solid PENINSULA hanging down from the top
  // middle, so the floodable area is a U — two arms joined across the bottom. Two
  // seeds, one per arm, flood the SAME connected concave region. Mask popcount
  // handles this natively; a Sutherland–Hodgman clip of the (non-convex) U-ring
  // would give a WRONG intersection area here.
  const uRoom = squareSegs(100, 100, 700, 500);             // outer room walls (600×400)
  const peninsula = squareSegs(300, 100, 500, 320);         // solid block hanging from the top → makes it a U
  const mo = buildMask([...border, ...uRoom, ...peninsula], IMG_W, IMG_H, MAXDIM);
  const leftArm = detectAt(mo, "101", [180, 200]);          // seed in the left arm
  const rightArm = detectAt(mo, "102", [620, 200]);         // seed in the right arm
  // both seeds flood the whole U (arms joined below the peninsula) → same region
  assert.ok(containmentSanity(leftArm, rightArm) > 0.9, "both arms flood the same connected U region");
  for (const input of [[leftArm, rightArm], [rightArm, leftArm]]) {
    const out = dedupeRegions(input);
    assert.equal(out.length, 1, "the two overlapping U floods collapse to one");
  }
});
