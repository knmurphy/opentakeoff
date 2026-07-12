// Detect Rooms (vector) core tests — issue #123. The pure units (label pattern
// filter + seed transform, and the seed→flood→status-gate fan-out) are DOM-free
// and pdfjs-free, so they run straight under node. Run with: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { roomLabelSeeds, detectRegions, ROOM_LABEL_RE } from "../src/lib/detectRooms.ts";
import { buildMask, SENS_BALANCED, type MaskObj } from "../src/lib/oneclick.ts";

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
