// A6 (audit) — ONE ENGINE. The canvas's One-Click, the batch detector, and the
// MCP server must measure the same seed on the same mask the same way. Before
// this, detectRegions (and mcp/src/session.ts) called the RAW floodRegion with
// no scale on the mask: no gap sealing, no minimum-passage rule, no door
// wedges, and every feet-true guard silently on its px fallback — while both
// surfaces still stamped origin.method "one_click_v1". Provenance could not
// tell an MCP measurement from a canvas one.
//
// These tests pin the equivalence on a fixture that DISCRIMINATES: a room whose
// only opening is an undrawn 3-ft doorway. The raw flood escapes through it and
// comes back "leak" (so the old detectRegions returned nothing at all); the
// sealed flood bridges the opening and measures the room. If the engine swap is
// reverted, the first test fails on the ring compare and the second on the
// count of detected rooms.
//
// The canvas call these mirror is TakeoffCanvas.jsx oneClickAt:
//   const mppf = mo.ws / upp;
//   floodRegionSealed(mo, x, y, fillSens, sealRadiiFor(mppf), doorWedgeCapPx(mppf), minPassRadiusFor(mppf))
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { detectRegions, floodAtSeed, oneClickArgs } from "../src/lib/detectRooms.ts";
import {
  buildMask, floodRegion, floodRegionSealed, sealRadiiFor, doorWedgeCapPx, minPassRadiusFor,
  traceRegion, ringArea, MASK_MAX_DIM, SENS_BALANCED, SEAL_RADII,
  type MaskObj, type FloodResult, type Point,
} from "../src/lib/oneclick.ts";
import { traceConfidence, floodSignals } from "../src/lib/confidence.ts";

// ── the fixture ────────────────────────────────────────────────────────────
// 1000 × 1000 image px at 36 px/ft — 1/4" = 1'-0" at the canvas's RENDER_SCALE
// of 2.0, which is also the only scale the MCP server ever renders at. Under
// MASK_MAX_DIM the working raster is 1:1, so 1 mask px = 1 image px and
// mppf = 36.
const IMG = 1000;
const UPP = 1 / 36;                 // real feet per image px
const PX_PER_FT = 1 / UPP;
const DOOR_PX = 108;                // a 3'-0" opening — far wider than SEAL_RADII's hairline floor

const seg = (x0: number, y0: number, x1: number, y1: number) => [x0, y0, x1, y1];
const rect = (x0: number, y0: number, x1: number, y1: number) => [
  ...seg(x0, y0, x1, y0), ...seg(x1, y0, x1, y1), ...seg(x1, y1, x0, y1), ...seg(x0, y1, x0, y0),
];

/** An outer enclosure (so an escaping fill has somewhere big to go) containing
 *  one room whose bottom wall has a DOOR_PX gap — an open doorway, the flood's
 *  classic dead end. */
function doorwaySegs(): number[] {
  const gx0 = 220, gx1 = gx0 + DOOR_PX;
  return [
    ...rect(40, 40, 960, 960),          // outer enclosure
    ...seg(100, 100, 400, 100),         // room: top
    ...seg(400, 100, 400, 400),         // room: right
    ...seg(100, 400, 100, 100),         // room: left
    ...seg(100, 400, gx0, 400),         // room: bottom, left of the opening
    ...seg(gx1, 400, 400, 400),         // room: bottom, right of the opening
  ];
}

const SEED: [number, number] = [250, 250];   // well inside the room

const doorwayMask = (pxPerFt: number): MaskObj =>
  buildMask(doorwaySegs(), IMG, IMG, MASK_MAX_DIM, null, pxPerFt, pxPerFt);

/** EXACTLY what TakeoffCanvas.jsx passes at a One-Click, with nothing else in
 *  the way — the reference the other surfaces are compared against. */
function canvasFlood(mo: MaskObj, ix: number, iy: number, sensitivity = SENS_BALANCED): FloodResult {
  const mppf = mo.ws / UPP;
  return floodRegionSealed(mo, ix, iy, sensitivity, sealRadiiFor(mppf), doorWedgeCapPx(mppf), minPassRadiusFor(mppf));
}

const ringOf = (f: FloodResult): Point[] => {
  assert.equal(f.status, "ok");
  return traceRegion(f as Extract<FloodResult, { status: "ok" }>);
};

test("buildMask carries the sheet scale: mppf is the canvas's own mo.ws / upp", () => {
  const mo = doorwayMask(PX_PER_FT);
  assert.equal(mo.mppf, mo.ws / UPP, "the mask's mppf IS the canvas's mppf expression");
  assert.equal(mo.mppf, 36);
  // and the scale-blind build says so honestly rather than guessing
  assert.equal(doorwayMask(0).mppf, 0);
});

test("the fixture discriminates: the raw flood leaks through the doorway, the sealed flood does not", () => {
  const mo = doorwayMask(PX_PER_FT);
  assert.equal(floodRegion(mo, SEED[0], SEED[1], SENS_BALANCED).status, "leak",
    "raw floodRegion escapes the undrawn doorway — this is the defect the audit measured");
  const f = canvasFlood(mo, SEED[0], SEED[1]);
  assert.equal(f.status, "ok");
  const ok = f as Extract<FloodResult, { status: "ok" }>;
  assert.ok(ok.sealedPx! >= DOOR_PX / 2, `the opening was bridged by a real seal radius, got ${ok.sealedPx}`);
  // the room is ~300 × 300 image px = 8.33 ft square ≈ 69.4 SF
  assert.ok(Math.abs(ringArea(traceRegion(ok)) * UPP * UPP - 69.4) < 2, "the sealed ring measures the room, not the sheet");
});

test("A6: detectRegions and the canvas produce the SAME ring for the same seed and mask", () => {
  const mo = doorwayMask(PX_PER_FT);
  const want = canvasFlood(mo, SEED[0], SEED[1]);
  const found = detectRegions(mo, [{ str: "101", seed: SEED }]);

  assert.equal(found.length, 1, "the batch detector finds the room the canvas finds (raw floodRegion found nothing)");
  assert.deepEqual(ringOf(found[0].flood), ringOf(want), "same seed, same mask, same ring");

  // ...and the same engine receipts, so provenance minted on either surface agrees
  const a = found[0].flood, b = want as Extract<FloodResult, { status: "ok" }>;
  assert.deepEqual(
    { count: a.count, sealedPx: a.sealedPx, virtualFrac: a.virtualFrac, wedges: a.wedges, hatchFiltered: a.hatchFiltered, mppf: a.mppf },
    { count: b.count, sealedPx: b.sealedPx, virtualFrac: b.virtualFrac, wedges: b.wedges, hatchFiltered: b.hatchFiltered, mppf: b.mppf },
  );
  // through floodSignals on BOTH sides, so the receipt covers every signal the
  // engine emits — not a hand-listed subset. Audit A2: hand-listing is how
  // `wedgeGrowth` came to be declared and supplied by nobody. (A fifth call
  // site in mcp/src/session.ts hand-listed its fields and so under-reported
  // A2/A3's signals; that was the follow-up this note used to name, and it is
  // done — the server's floodStamp now reads them off floodSignals, which the
  // F7(d) guards at the bottom of this file pin.)
  assert.deepEqual(
    traceConfidence(floodSignals(a)),
    traceConfidence(floodSignals(b)),
    "the confidence receipt is the same on both surfaces",
  );
  assert.ok(traceConfidence(floodSignals(a)).score < 1,
    "a sealed doorway costs confidence — the score is not a rubber stamp",
  );
});

// floodAtSeed is the entry point mcp/src/session.ts's one_click measures
// through (and detectRegions with it), so pinning it here pins the MCP
// surface's engine as far as a web-side test can reach — the MCP server's own
// deps are not installed for the web CI job, so its Session can't be imported.
test("A6: floodAtSeed IS the canvas call — same ring, same receipts, same args", () => {
  const mo = doorwayMask(PX_PER_FT);
  const want = canvasFlood(mo, SEED[0], SEED[1]);
  const got = floodAtSeed(mo, SEED[0], SEED[1]);
  assert.deepEqual(ringOf(got), ringOf(want));
  assert.deepEqual(got, want, "identical FloodResult, receipts included");

  // and the argument derivation itself, against the canvas's own expressions
  const mppf = mo.ws / UPP;
  assert.deepEqual(oneClickArgs(mppf), {
    mppf, scaleBlind: false,
    radii: sealRadiiFor(mppf), wedgeCapPx: doorWedgeCapPx(mppf), minPassPx: minPassRadiusFor(mppf),
  });
  // scale unknown → the documented fallbacks, flagged, never invented
  assert.deepEqual(oneClickArgs(0), { mppf: 0, scaleBlind: true, radii: SEAL_RADII, wedgeCapPx: 0, minPassPx: 0 });
  for (const bad of [NaN, -1, Infinity]) assert.equal(oneClickArgs(bad).scaleBlind, true, `${bad}`);
});

test("A6: the sensitivity knob reaches the same engine on both surfaces", () => {
  const mo = doorwayMask(PX_PER_FT);
  for (const sens of [0, 0.5, 1]) {
    const want = canvasFlood(mo, SEED[0], SEED[1], sens);
    const found = detectRegions(mo, [{ str: "101", seed: SEED }], sens);
    assert.equal(found.length, 1, `sensitivity ${sens}`);
    assert.deepEqual(ringOf(found[0].flood), ringOf(want), `sensitivity ${sens}: same ring`);
  }
});

test("no scale: detectRegions falls back explicitly (and visibly), it does not invent an mppf", () => {
  const blind = doorwayMask(0);
  assert.equal(blind.mppf, 0);
  // sealRadiiFor(0)/doorWedgeCapPx(0)/minPassRadiusFor(0) are the documented
  // scale-blind fallbacks: hairline drafting gaps only, no door wedges, no
  // minimum-passage rule. A 3-ft doorway is far beyond them, so the room is
  // NOT recovered — the fallback is a different (and weaker) measurement, which
  // is exactly why the MCP surfaces surface it instead of measuring silently.
  assert.deepEqual(detectRegions(blind, [{ str: "101", seed: SEED }]), []);
  assert.equal(detectRegions(doorwayMask(PX_PER_FT), [{ str: "101", seed: SEED }]).length, 1,
    "with the scale, the same seed on the same linework IS a room — the scale genuinely rides through");
});

test("a mask with no mppf (the raster path) takes the scale as an explicit argument", () => {
  const scaled = doorwayMask(PX_PER_FT);
  // buildRasterMask never sets mppf; the canvas passes rmo.ws / upp by hand.
  const raster: MaskObj = { mask: scaled.mask, mw: scaled.mw, mh: scaled.mh, ws: scaled.ws, softCount: scaled.softCount };
  const found = detectRegions(raster, [{ str: "101", seed: SEED }], SENS_BALANCED, raster.ws / UPP);
  assert.equal(found.length, 1);
  assert.deepEqual(ringOf(found[0].flood), ringOf(canvasFlood(scaled, SEED[0], SEED[1])),
    "explicit maskPxPerFt reproduces the canvas ring exactly",
  );
});

// ── the design intent the swap must NOT change ─────────────────────────────
// detectRegions gates on flood STATUS alone. hatchFiltered rides through as
// provenance, never a rejection reason (most rooms on a finish plan are
// hatched). Hand-built tiered mask: a soft (bit 2) partition splits a hard box,
// so the strict pass is hatch-bounded and the escalation crosses it.
test("detectRegions still gates on status only — a hatchFiltered 'ok' is kept, not rejected", () => {
  const mw = 400, mh = 400, lo = 100, hi = 300;   // the box stays well under the leak cap (30% of the mask)
  const mask = new Uint8Array(mw * mh);
  for (let x = lo; x <= hi; x++) { mask[lo * mw + x] = 1; mask[hi * mw + x] = 1; }
  for (let y = lo; y <= hi; y++) { mask[y * mw + lo] = 1; mask[y * mw + hi] = 1; }
  let softCount = 0;
  for (let y = lo + 1; y < hi; y++) { mask[y * mw + 200] = 2; softCount++; }   // soft partition
  const mo: MaskObj = { mask, mw, mh, ws: 1, softCount, mppf: 36 };

  const want = canvasFlood(mo, 150, 200);
  assert.equal(want.status, "ok");
  assert.equal((want as Extract<FloodResult, { status: "ok" }>).hatchFiltered, true,
    "sanity: the escalation crossed the soft partition");

  const found = detectRegions(mo, [{ str: "101", seed: [150, 200] }]);
  assert.equal(found.length, 1, "hatchFiltered is provenance, never a rejection reason");
  assert.equal(found[0].flood.hatchFiltered, true);
  assert.deepEqual(ringOf(found[0].flood), ringOf(want));
});

// ── F7(d): the MCP provenance surface must carry every receipt the canvas does ─
// A6's failure class, one surface further out. `mcp/src/session.ts`'s receipt
// mapping is a HAND-LISTED field set; the canvas mints `min_pass_px` /
// `min_pass_delta` (from A3) on its proposal origin and on its agent one-click
// reply, and the mapping did not, so an MCP caller could not tell a verbatim
// closet from one the minimum-passage rule had trimmed a third off — only
// `confidence` moved, with nothing machine-readable saying why. Measured on the
// real VA finish plan through the MCP Session after the fix: seven of seven
// scaled probes that traced report `min_pass_px: 2` with
// `min_pass_delta` 0.0101–0.8288.
//
// Neither file can be executed from this suite (mcp has its own dependency tree
// and its tests live under mcp/test), so this is a source-level guard — the same
// device benchProductionRing.test.ts uses for the ring call sites. Two things it
// pins, and the second is the general form of the defect:
//   1. the mapping emits the min-passage pair on the SAME condition the canvas
//      uses (`minPassDelta` truthy — the engine decides when that is set);
//   2. EVERY key it can emit is DECLARED in mcp/src/outputs.ts. The
//      conformance suite runs the schemas with `.strict()`, so an undeclared key
//      fails there — this makes it fail here too, in the suite that owns parity,
//      and names the missing key instead of printing a zod path.
//
// RE-POINTED 2026-08-04 (upstream sync): the fork's `receipts()` and upstream's
// `floodStamp()` are the same mapping, reached from the same two call paths.
// Upstream's reads the pair off `floodSignals(f)` rather than off `f` directly,
// so the gate reads `sig.minPassDelta`; the INVARIANT — one condition, both
// fields, every emitted key declared — is unchanged, and that is what is pinned.
const mcpSrc = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");

test("F7(d): the mcp flood stamp mints the min-passage pair on the canvas's own condition", () => {
  const session = mcpSrc("../../mcp/src/session.ts");
  const body = session.match(/private static floodStamp\([\s\S]*?\n  \}/);
  assert.ok(body, "floodStamp() not found in mcp/src/session.ts — re-point this guard");
  assert.match(body[0], /sig\.minPassDelta \? \{ min_pass_px: sig\.minPassPx \|\| 0, min_pass_delta: sig\.minPassDelta \}/,
    "the stamp must emit min_pass_px + min_pass_delta together, gated on minPassDelta");
  // …and the canvas gates on exactly the same fact, in both of the places it mints them
  const canvas = mcpSrc("../src/pages/TakeoffCanvas.jsx");
  assert.match(canvas, /mp: f\.minPassDelta \? \(f\.minPassPx \|\| 0\) : 0, mpd: f\.minPassDelta \|\| 0/,
    "the canvas's proposal record must still carry the pair gated on minPassDelta");
  assert.match(canvas, /f\.minPassDelta \? \{ min_pass_px: f\.minPassPx, min_pass_delta: f\.minPassDelta \}/,
    "…and so must the agent one-click reply");
});

test("F7(d): every receipt key mcp can emit is DECLARED in outputs.ts (both schemas)", () => {
  const session = mcpSrc("../../mcp/src/session.ts");
  const outputs = mcpSrc("../../mcp/src/outputs.ts");
  const body = session.match(/private static floodStamp\([\s\S]*?\n  \}/);
  assert.ok(body, "floodStamp() not found in mcp/src/session.ts — re-point this guard");
  // every key the stamp can put on a reply — read off its returned literal, so
  // adding a receipt without declaring it fails HERE rather than in a zod path
  const ret = body[0].match(/return \{[\s\S]*?\n    \};/);
  assert.ok(ret, "the stamp must end in a single returned object literal — re-point this guard");
  const keys = [...ret[0].matchAll(/[{,]\s*([a-z][a-z0-9_]*):/g)].map((m) => m[1]);
  assert.ok(keys.length >= 9, `expected the full receipt set, found ${keys.length}: ${keys.join(", ")}`);
  assert.ok(keys.includes("min_pass_px") && keys.includes("min_pass_delta"), "the F7(d) pair must be in the emitted set");
  // outputs.ts declares oneClickOutput and detectedRoom; a receipt rides into BOTH
  const oneClick = outputs.match(/export const oneClickOutput = \{[\s\S]*?\n\};/);
  const detected = outputs.match(/const detectedRoom = z\.object\(\{[\s\S]*?\n\}\)\.strict\(\);/);
  assert.ok(oneClick && detected, "outputs.ts shape changed — re-point this guard");
  for (const key of new Set(keys)) {
    assert.match(oneClick[0], new RegExp(`\\n  ${key}: z\\.`), `oneClickOutput does not declare \`${key}\` — the conformance suite's .strict() will reject it`);
    assert.match(detected[0], new RegExp(`\\n  ${key}: z\\.`), `detectedRoom does not declare \`${key}\` — per-room replies carry the receipts spread`);
  }
  assert.match(detected[0], /\}\)\.strict\(\)/, "detectedRoom must stay .strict() — that is what makes an undeclared key fail");
});
