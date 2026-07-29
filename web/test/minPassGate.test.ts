// The minimum-passage gate — audit F1/F2.
//
// `sealAttempt`'s min-passage path is a DILATION path, so audit A3 put the seal
// ladder's two sanity gates on it (room-size cap + ≥75%-real-boundary). Applied
// UNCONDITIONALLY that was a regression, and this file is the guard:
//
//   F1  A refused min-passage region fell through to the RAW flood, which was
//       returned bare — no minPassPx/minPassDelta, no sealedPx/virtualFrac — so
//       `floodSignals` saw nothing and traceConfidence scored it 1.00. On the
//       scene below the answer stepped from 64.4 SF at 0.99 to 126.6 SF at 1.00
//       when the slots widened by ONE image pixel (0.400 ft → 0.433 ft).
//   F2  Same gate, other geometry: min-passage refused, raw flood leaks, ladder
//       (rungs > minPassPx only) finds nothing ⇒ `leak` where a room used to be.
//       Those refusals are KEPT and pinned below — see the F2 block.
//
// The fix scopes the gates to the case they were written for. When the VERBATIM
// linework already bounds the clicked space the rule is TRIMMING, its region is
// a subset of a region that already passed both gates, and every synthetic run
// on its boundary bridges a gap the rule itself just judged narrower than
// MIN_PASS_FT — so neither gate is asking a question about it. When the verbatim
// flood is unbounded the rule is CREATING boundedness (the ladder's job under
// another name) and both gates run unchanged.
//
// THE SCENE. A room whose wall is drawn as a picket/dashed run — short dashes
// separated by sub-half-foot slots — inside a solidly walled suite. Every slot
// is narrower than MIN_PASS_FT, so the rule's verdict ("these do not connect
// two spaces") is the correct one, and the raw flood that leaks through them
// into the suite is the wrong answer. 911×756 image px at 30 px/ft; the mask is
// built at maxDim 700 so the working raster lands at 23.05 px/ft — the shape a
// >3000 px sheet takes under MASK_MAX_DIM, and the resolution at which the
// defect was first measured (minPassPx 6).
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildMask, floodRegion, floodRegionSealed, sealRadiiFor, doorWedgeCapPx,
  minPassRadiusFor, MIN_PASS_FT, DETERMINISM_MIN_MPPF, SENS_BALANCED,
  traceRegion, ringArea, type FloodResult, type MaskObj,
} from "../src/lib/oneclick.ts";
import { traceConfidence, floodSignals } from "../src/lib/confidence.ts";

const W = 911, H = 756, PXFT = 30;
const SEED: [number, number] = [190, 210];          // the room's centre
const ROOM_SF = (220 / PXFT) * (260 / PXFT);        // 63.6 SF — the room's own footprint
const SUITE_SF = (320 / PXFT) * (360 / PXFT);       // 128.0 SF — what the raw flood reaches

type Ok = Extract<FloodResult, { status: "ok" }>;
const L = (s: number[], x0: number, y0: number, x1: number, y1: number) => s.push(x0, y0, x1, y1);

/** `slotPx` — the drafting gap between dashes, image px. `suite` — whether the
 *  room sits inside a solidly walled suite (⇒ the verbatim flood is BOUNDED,
 *  the trimming case) or alone on the sheet (⇒ unbounded, the creating case). */
function picketRoom(slotPx: number, opts: { suite: boolean; dashPx?: number }): number[] {
  const dashPx = opts.dashPx ?? 2;
  const s: number[] = [];
  L(s, 2, 2, W - 2, 2); L(s, W - 2, 2, W - 2, H - 2); L(s, W - 2, H - 2, 2, H - 2); L(s, 2, H - 2, 2, 2);
  if (opts.suite) { L(s, 40, 40, 360, 40); L(s, 360, 40, 360, 400); L(s, 360, 400, 40, 400); L(s, 40, 400, 40, 40); }
  const run = (x0: number, y0: number, x1: number, y1: number) => {
    const len = Math.hypot(x1 - x0, y1 - y0), ux = (x1 - x0) / len, uy = (y1 - y0) / len;
    for (let t = 0; t < len; t += dashPx + slotPx) {
      const e = Math.min(t + dashPx, len);
      L(s, x0 + ux * t, y0 + uy * t, x0 + ux * e, y0 + uy * e);
    }
  };
  run(80, 80, 300, 80); run(300, 80, 300, 340); run(300, 340, 80, 340); run(80, 340, 80, 80);
  return s;
}

function measure(segs: number[], maxDim: number) {
  const mo: MaskObj = buildMask(segs, W, H, maxDim, null, PXFT);
  const mppf = mo.mppf ?? 0;
  const minPassPx = minPassRadiusFor(mppf);
  const raw = floodRegion(mo, SEED[0], SEED[1], SENS_BALANCED);
  const f = floodRegionSealed(mo, SEED[0], SEED[1], SENS_BALANCED, sealRadiiFor(mppf), doorWedgeCapPx(mppf), minPassPx);
  const ok = f.status === "ok" ? (f as Ok) : null;
  // ringArea(traceRegion(...)) is already in IMAGE px — the production quantity
  const ringSF = ok ? ringArea(traceRegion(ok)) / (PXFT * PXFT) : NaN;
  const conf = ok ? traceConfidence(floodSignals(ok, { areaSF: ringSF })) : null;
  return { mo, mppf, minPassPx, raw, f, ok, ringSF, cellSF: ok ? ok.count / (mppf * mppf) : NaN, conf };
}

// Every slot width used below must be genuinely sub-MIN_PASS_FT, or the rule
// severing it would be the arguable call rather than the correct one.
const TRIM_SLOTS = [12, 13, 14, 15];                 // 0.400 … 0.500 ft at 30 px/ft

test("F1: a picket wall inside a suite measures the ROOM — the refused min-passage region never falls through to the raw flood", () => {
  for (const slotPx of TRIM_SLOTS) {
    const slotFt = slotPx / PXFT;
    assert.ok(slotFt <= MIN_PASS_FT, `fixture: ${slotFt} ft slot must be sub-MIN_PASS_FT`);
    const m = measure(picketRoom(slotPx, { suite: true }), 700);
    assert.ok(m.mppf >= DETERMINISM_MIN_MPPF, `scene must sit above the determinism floor (got ${m.mppf})`);
    assert.equal(m.minPassPx, 6, "the resolution the defect was measured at");
    assert.equal(m.raw.status, "ok", "fixture: the VERBATIM linework must bound this space (the trimming case)");
    assert.equal(m.f.status, "ok");
    // the room, not the suite
    assert.ok(Math.abs(m.cellSF - ROOM_SF) < 3, `${slotFt} ft slot: expected ~${ROOM_SF.toFixed(1)} SF (the room), got ${m.cellSF.toFixed(1)} SF`);
    assert.ok(m.cellSF < SUITE_SF * 0.75, `${slotFt} ft slot: answered ${m.cellSF.toFixed(1)} SF — that is the SUITE, reached by leaking through slots the rule judged impassable`);
    // ...and it says so
    assert.equal((m.ok as Ok).minPassPx, 6, `${slotFt} ft slot: no min_pass_px provenance`);
    const d = (m.ok as Ok).minPassDelta ?? 0;
    assert.ok(d > 0.4 && d < 0.6, `${slotFt} ft slot: minPassDelta ${d} — the rule removed ~half the verbatim flood here`);
    assert.equal(m.conf!.score, 0.99, `${slotFt} ft slot: confidence ${m.conf!.score} with factors ${JSON.stringify(m.conf!.factors)}`);
  }
});

test("F1: no cliff — widening the slots by one raster cell must not double the answer", () => {
  const runs = [8, 10, 11, 12, 13, 14, 15].map((slotPx) => ({ slotPx, ...measure(picketRoom(slotPx, { suite: true }), 700) }));
  for (const r of runs) {
    assert.equal(r.f.status, "ok", `${r.slotPx}px slot: ${r.f.status}`);
    assert.ok((r.ok as Ok).minPassDelta, `${r.slotPx}px slot: the rule changed the answer and reported nothing`);
    // the brief's own line: never 64 → 121 SF at 1.00
    assert.ok(r.conf!.score < 1, `${r.slotPx}px slot: confidence 1.00 on a region the minimum-passage rule created`);
  }
  const sfs = runs.map((r) => r.cellSF);
  const spread = Math.max(...sfs) - Math.min(...sfs);
  assert.ok(spread < 2, `answer moved ${spread.toFixed(1)} SF across a 8→15 px slot sweep: ${sfs.map((v) => v.toFixed(1)).join(", ")}`);
});

test("F1: on the trimming path the region is a strict subset of the verbatim flood — so the room-size cap it inherits is redundant, not skipped", () => {
  const m = measure(picketRoom(13, { suite: true }), 700);
  const raw = m.raw as Ok, out = m.ok as Ok;
  assert.ok(out.count < raw.count, `expected a real trim (${out.count} vs raw ${raw.count})`);
  let outside = 0;
  for (let i = 0; i < out.region.length; i++) if (out.region[i] && !raw.region[i]) outside++;
  assert.equal(outside, 0, `${outside} returned cells lie outside the verbatim flood — the subset argument the gate-scoping rests on is false`);
});

test("F1: the trim holds at the un-downscaled raster too (ws 1, minPassPx 8)", () => {
  const m = measure(picketRoom(13, { suite: true }), W);
  assert.equal(m.mo.ws, 1);
  assert.equal(m.minPassPx, 8);
  assert.equal(m.f.status, "ok");
  assert.ok(Math.abs(m.cellSF - ROOM_SF) < 3, `expected ~${ROOM_SF.toFixed(1)} SF, got ${m.cellSF.toFixed(1)} SF`);
  assert.ok((m.ok as Ok).minPassDelta, "no min-passage provenance");
  assert.ok(m.conf!.score < 1, `confidence ${m.conf!.score}`);
});

// ── F2: the CREATING path — refusals pinned as deliberate ───────────────────
// Same picket room, alone on the sheet: the verbatim linework encloses nothing,
// so the dilation is not trimming a hairline connection, it is INVENTING the
// enclosure. That is the seal ladder's job under another name, both gates run
// exactly as they do for a ladder rung, and F2's `ok → leak` flips live here.
//
// They are kept, for two reasons that had to be measured rather than assumed:
//   • The refusal is the gate doing its job. `A3/D-1` in resolutionInvariance
//     .test.ts is the same shape at 72 px/ft — a "room" drawn as a dotted line —
//     and refusing it is the behaviour that test was written to protect.
//   • A 47,732-click sweep of both corpus sheets (sample-plan, va-finish-plan)
//     at ws 1 and ws 0.5 produced 35 gate refusals and ZERO of this shape: on
//     both real drawings the verbatim flood was bounded every single time, i.e.
//     every refusal was F1, none was F2. The handoff's "~0.2% of 1044 probes"
//     was not reproducible against this corpus.
// What is NOT defensible is silence about it, so the flip is pinned below.

test("F2 pinned: on the creating path a boundary that is mostly dilation-invented is still refused", () => {
  // 0.433 ft slots at 23.05 px/ft leave ~27% of the candidate's boundary more
  // than three cells (VIRTUAL_HUG_PX) from any linework. The verbatim flood is
  // unbounded, so there is no superset that already passed the gates and
  // nothing but the dilation holding the region together. The estimator gets
  // "not enclosed", which is what the drawing says. Turning this into a
  // measurement is a decision about what a dashed line MEANS; not made here.
  const m = measure(picketRoom(13, { suite: false }), 700);
  assert.equal(m.raw.status, "leak", "fixture: the verbatim linework must NOT bound this space");
  assert.equal(m.f.status, "leak");
});

test("F2 pinned: an ACCEPTED creating-path region reports the whole bridge — gap_sealed_px, its virtual fraction, and the sole-min-passage deduction", () => {
  const m = measure(picketRoom(10, { suite: false }), 700);
  assert.equal(m.raw.status, "leak", "fixture: the verbatim linework must NOT bound this space");
  assert.equal(m.f.status, "ok");
  const out = m.ok as Ok;
  assert.equal(out.minPassPx, 6);
  assert.equal(out.minPassDelta, 1, "the rule is the only reason there is a measurement");
  assert.equal(out.sealedPx, 6, "gap_sealed_px must name the radius that bridged");
  assert.ok((out.virtualFrac ?? 0) > 0, `virtualFrac ${out.virtualFrac} — the synthetic share of the boundary must be reported`);
  assert.ok(m.conf!.score <= 0.8, `confidence ${m.conf!.score} — an invented enclosure must be flagged hard`);
  assert.ok(m.conf!.factors.some((s) => s.startsWith("undecidable-passage")), JSON.stringify(m.conf!.factors));
});

test("KNOWN LIMIT (F2b): the creating-path refusal moves with the working raster", () => {
  // The SAME drawing, 0.333 ft slots — decisively sub-MIN_PASS_FT at every
  // resolution here — is a 64 SF room at 16.5 and 23.1 px/ft and `leak` at 30.
  // Cause: virtualBoundaryFrac's margin is a fixed 3 cells while the dilation
  // radius it judges is minPassRadiusFor(mppf), which grows with the raster, so
  // the same slot contributes more synthetic boundary the finer the mask gets.
  // This is NOT fixable by making the margin feet-true — measured, and it blinds
  // the gate at the rule's own scale (see virtualBoundaryFrac's note and the
  // A3/D-1 fixture). The honest fix is to count a boundary cell as synthetic
  // when its barrier neighbour is DILATED rather than DRAWN, which recalibrates
  // SEAL_VIRTUAL_MAX and every virtualFrac the corpus reads — a change with its
  // own review. Pinned in BOTH directions so closing it breaks this test.
  const coarse = measure(picketRoom(10, { suite: false }), 700);
  const fine = measure(picketRoom(10, { suite: false }), W);
  assert.ok(10 / PXFT < MIN_PASS_FT - 1 / fine.mppf, "fixture: the slot must sit clear of the undecidable band");
  assert.equal(coarse.f.status, "ok", "at 23.05 px/ft the gate accepts the invented enclosure");
  assert.ok(coarse.conf!.score <= 0.8, `confidence ${coarse.conf!.score}`);
  assert.equal(fine.f.status, "leak", "at 30 px/ft the same drawing is refused — the limit this pins");
});

test("A3's room-size cap still refuses an oversize enclosure reached through a sub-half-foot slot", () => {
  // docs/evidence/probes/a3.mts S1, the one gate on this path with a
  // demonstrated true positive: a 700×350 px room behind a 0.40 ft slot whose
  // dilated flood lands just under the 30%-of-sheet cap and whose growback
  // pushes it over. 1000×800 at 18 px/ft, exactly as the probe builds it.
  const w = 1000, h = 800, pxft = 18;
  const s: number[] = [];
  L(s, 2, 2, w - 2, 2); L(s, w - 2, 2, w - 2, h - 2); L(s, w - 2, h - 2, 2, h - 2); L(s, 2, h - 2, 2, 2);
  const x0 = 100, y0 = 100, x1 = 800, y1 = 450, gap = 0.40 * pxft, cy = (y0 + y1) / 2;
  L(s, x0, y0, x1, y0); L(s, x1, y1, x0, y1); L(s, x0, y1, x0, y0);
  L(s, x1, y0, x1, cy - gap / 2); L(s, x1, cy + gap / 2, x1, y1);
  const mo = buildMask(s, w, h, 1000, null, pxft);
  const mppf = mo.mppf ?? 0;
  const raw = floodRegion(mo, 450, 275, SENS_BALANCED);
  assert.equal(raw.status, "leak", "fixture: the verbatim linework must NOT bound this space");
  const f = floodRegionSealed(mo, 450, 275, SENS_BALANCED, sealRadiiFor(mppf), doorWedgeCapPx(mppf), minPassRadiusFor(mppf));
  assert.equal(f.status, "leak", "a 753 SF 'room' that is 30% of the sheet must not be minted by a dilation");
});
