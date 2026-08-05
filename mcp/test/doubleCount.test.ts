// ── the same floor must never be sold twice ─────────────────────────────────
//
// The bench already has a pairwise-overlap invariant (`pairwiseOverlapFrac`,
// bench/run.mts) and it is the right idea, deliberately NOT engine-self-
// referential: two regions claiming the same floor is double-counted SF
// whoever authored the answer key. Its blindness is COVERAGE. It compares the
// eight pinned probes of a case against each other, and on the VA finish plan
// none of those eight sits near room 158 or corridor CE-5 — so it reports
// 0.000% while the product returns 16 SF of the same floor from two ordinary
// clicks.
//
// It is blind for a structural reason, not a sampling accident: BOTH defects
// below are between a room `detect_rooms` finds and a space it never reaches,
// because the space carries no room number. detect_rooms' own output is
// internally clean — every pair of its 27 rings overlaps by exactly 0.00 SF —
// so no test built out of detect_rooms alone can see this, and neither can a
// probe set drawn from rooms.
//
// This test is built out of the workflow instead: sweep the sheet, then click
// everything the sweep REPORTED but could not commit (`unnamed_spaces[]` — the
// circulation), and check the union for floor claimed twice. That is what an
// estimator does, in that order, and it is where the defect lives.
//
// Found by adversarial review of the 2026-08-04 upstream sync. Both instances
// are UPSTREAM ENGINE changes, proven by re-running this same loop against
// each older engine in turn; the fork's detect_rooms graft contributes 0.00 SF.
// They are pinned here as known defects — gated so they cannot GROW, and gated
// so that fixing them breaks this test and forces the pin to be retired rather
// than left lying. Reported upstream; see docs/evidence/upstream-sync-2026-08/.
import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { Session } from "../src/session.ts";

const PLAN = fileURLToPath(new URL("../../demo/sample-finish-plan.pdf", import.meta.url));
const KEY = "sample-finish-plan.pdf";

/** Scanline-fill a ring (image px) to a cell set — exact enough at 1 px that
 *  the overlap number is the measurement, not an estimate. */
function cells(ring: number[][], W = 8192): Set<number> {
  const out = new Set<number>();
  let lo = Infinity, hi = -Infinity;
  for (const [, y] of ring) { if (y < lo) lo = y; if (y > hi) hi = y; }
  for (let y = Math.floor(lo); y <= Math.ceil(hi); y++) {
    const xs: number[] = [];
    for (let i = 0; i < ring.length; i++) {
      const [ax, ay] = ring[i], [bx, by] = ring[(i + 1) % ring.length];
      if ((ay <= y && by > y) || (by <= y && ay > y)) xs.push(ax + ((y - ay) / (by - ay)) * (bx - ax));
    }
    xs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2)
      for (let x = Math.ceil(xs[k]); x <= Math.floor(xs[k + 1]); x++) out.add(y * W + x);
  }
  return out;
}

const overlap = (a: Set<number>, b: Set<number>) => {
  const [big, small] = a.size >= b.size ? [a, b] : [b, a];
  let n = 0;
  for (const c of small) if (big.has(c)) n++;
  return n;
};

test("no floor is billed twice: every room the sweep finds against every space it reports", async () => {
  const s = new Session();
  await s.loadPlan(PLAN);
  s.setScale(KEY, { use_detected: true });
  const upp = (s as unknown as { sheet(k: string): { upp: number } }).sheet(KEY).upp;
  const sf = (n: number) => n * upp * upp;

  const r = await s.detectRooms(KEY, { role: "floor_area", returnVerts: true }) as unknown as {
    rooms: { label: string; verts: number[][] }[];
    unnamed_spaces?: { label: string; seed: [number, number] }[];
  };

  const regions: { name: string; cells: Set<number> }[] =
    r.rooms.map((room) => ({ name: `room ${room.label}`, cells: cells(room.verts) }));

  // …and the circulation, clicked at the seeds the sweep itself handed back.
  // This is the half no room-derived probe set can reach.
  for (const u of r.unnamed_spaces ?? []) {
    const click = await s.oneClick(KEY, u.seed[0], u.seed[1], { role: "floor_area", returnVerts: true }) as unknown as { verts?: number[][] };
    if (click.verts && click.verts.length >= 3) regions.push({ name: `space ${u.label}`, cells: cells(click.verts) });
  }

  // …and spaces with NEITHER a room number NOR a printed area, which nothing
  // automatic can enumerate — a finish cell marked only by its own CPT-1 /
  // P-1 tags. An estimator reaches these by looking at the drawing, so the
  // only honest way to cover them is to name the seed. Each entry is a place
  // the sheet finishes separately; add one whenever a defect turns up in a
  // space the two automatic passes above cannot reach.
  const HAND_CLICKS: { name: string; seed: [number, number] }[] = [
    { name: "lobe s/of 140 (own CPT-1 + P-1 tags)", seed: [3530, 1100] },
  ];
  for (const h of HAND_CLICKS) {
    const click = await s.oneClick(KEY, h.seed[0], h.seed[1], { role: "floor_area", returnVerts: true }) as unknown as { verts?: number[][] };
    assert.ok(click.verts && click.verts.length >= 3, `the hand-click seed for ${h.name} still lands in a traceable space`);
    regions.push({ name: h.name, cells: cells(click.verts!) });
  }
  assert.ok(regions.length >= 30, `the union under test is the whole sheet, got ${regions.length} regions`);

  const shared: { pair: string; sf: number }[] = [];
  for (let i = 0; i < regions.length; i++)
    for (let j = i + 1; j < regions.length; j++) {
      const n = overlap(regions[i].cells, regions[j].cells);
      if (sf(n) >= 1) shared.push({ pair: `${regions[i].name} × ${regions[j].name}`, sf: +sf(n).toFixed(2) });
    }
  shared.sort((a, b) => b.sf - a.sf);

  // The two known defects, each named so a THIRD one cannot hide in a total.
  // Gated on the SF, not on the pair list, so the pin fails if either grows.
  const KNOWN: Record<string, { at_most: number; cause: string }> = {
    "room 158 × space 557 SF": {
      at_most: 20,
      cause: "upstream #191 — the in-swing door LEAF retry annexes room 158's east door sector into BOTH the room and corridor CE-5. 0.00 SF before #191; the room gained +16.57 and the corridor +15.88, and 16.17 of that is the same floor. The sheet prints 557 SF for that corridor and the engine returns 640.",
    },
    "room 140 × lobe s/of 140 (own CPT-1 + P-1 tags)": {
      at_most: 20,
      cause: "upstream #188 — the annotation-ring recovery lets room 140 swallow a lobe that carries its OWN CPT-1 floor tag and P-1 wall tag. 0.47 SF before #188, 13.99 after: 99.9% of a separately finish-tagged space now sits inside another room.",
    },
  };

  const surprises = shared.filter((x) => !(x.pair in KNOWN));
  assert.deepEqual(surprises, [],
    `floor claimed twice by a pair nobody has adjudicated. Every entry here is square footage a bid would carry twice:\n  ${surprises.map((x) => `${x.pair} = ${x.sf} SF`).join("\n  ")}`);

  for (const [pair, k] of Object.entries(KNOWN)) {
    const hit = shared.find((x) => x.pair === pair);
    // Fixed upstream? Then this pin is stale and must be retired, not left to
    // rot into a claim nobody rechecks — the xfail discipline the confidence
    // gate already uses (bench/run.mts's EXEMPT rows).
    assert.ok(hit, `${pair} no longer double-counts — the defect is FIXED. Delete its entry from KNOWN and say so in the CHANGELOG.\n  cause on record: ${k.cause}`);
    assert.ok(hit!.sf <= k.at_most, `${pair} double-counts ${hit!.sf} SF, over its pinned ceiling of ${k.at_most}.\n  cause on record: ${k.cause}`);
  }
});
