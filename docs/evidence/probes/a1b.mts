// A1b — how severe is the Hi-Res toggle, really? A slit-width sweep.
//
// docs/audit/ISSUE_184_AUDIT.md claims the toggle moved one click from 97.8 SF
// to 134.0 SF (+37%) on an 11x17 at 1/8" with a "0.60-0.63 ft slit". That number
// is quoted in oneclick.ts and in two AFTER tests, but the scene it came from was
// not preserved (the a1Scene() in resolutionInvariance.test.ts has a 1.78 ft
// gap and cannot produce it). This probe rebuilds a scene of that shape and
// sweeps the slit width, so the flip band is MEASURED rather than asserted.
//
// Scene: 11x17 portrait (792 x 1224 pt) at 1/8" = 1'-0" (9 pt/ft).
//   Room A  12 ft x 8 ft = 108 x 72 pt  (96.0 SF nominal)
//   Room B  12 ft x 4 ft = 108 x 36 pt  (48.0 SF nominal), directly below A
//   The party wall between them carries ONE slit of width w_ft. Seed in room A.
// If the slit reads as passable the click returns A+B; if not, A alone.
//
// Rendered at rs 2.000 (Hi-Res OFF) and rs 5.374 (Hi-Res ON on an 11x17).
// Identical file on BEFORE and AFTER; buildMask's 7th arg does not exist on BEFORE.
import {
  buildMask, floodRegionSealed, sealRadiiFor, doorWedgeCapPx, minPassRadiusFor,
  traceRegion, ringArea, MASK_MAX_DIM,
} from "../src/lib/oneclick.ts";

const PAGE_W = 792, PAGE_H = 1224, PT_PER_FT = 9, BASE_RS = 2;

function scene(slitFt: number, rs: number) {
  const segs: number[] = [];
  const L = (x0: number, y0: number, x1: number, y1: number) => segs.push(x0 * rs, y0 * rs, x1 * rs, y1 * rs);
  // sheet border
  L(20, 20, PAGE_W - 20, 20); L(PAGE_W - 20, 20, PAGE_W - 20, PAGE_H - 20);
  L(PAGE_W - 20, PAGE_H - 20, 20, PAGE_H - 20); L(20, PAGE_H - 20, 20, 20);
  const x0 = 200, x1 = 308, yA = 200, yM = 272, yB = 308;   // 108 pt wide; A 72 pt tall; B 36 pt tall
  L(x0, yA, x1, yA); L(x1, yA, x1, yB); L(x1, yB, x0, yB); L(x0, yB, x0, yA);   // outer box of A+B
  const half = (slitFt * PT_PER_FT) / 2, cx = (x0 + x1) / 2;
  L(x0, yM, cx - half, yM); L(cx + half, yM, x1, yM);                            // party wall with slit
  return { segs, w: Math.ceil(PAGE_W * rs), h: Math.ceil(PAGE_H * rs), pxPerFt: PT_PER_FT * rs, base: PT_PER_FT * BASE_RS, seed: [254 * rs, 230 * rs] as [number, number] };
}

function measure(slitFt: number, rs: number) {
  const s = scene(slitFt, rs);
  const mo = buildMask(s.segs, s.w, s.h, MASK_MAX_DIM, null, s.pxPerFt, s.base);   // arg 7 absent on BEFORE
  const mppf = mo.mppf || 0;
  const f: any = floodRegionSealed(mo, s.seed[0], s.seed[1], 0.5, sealRadiiFor(mppf), doorWedgeCapPx(mppf), minPassRadiusFor(mppf));
  if (f.status !== "ok") return { status: f.status, mppf: +mppf.toFixed(4), sf: null as number | null };
  return {
    status: "ok", mppf: +mppf.toFixed(4), mw: mo.mw, mh: mo.mh,
    sf: +(ringArea(traceRegion(f)) / (s.pxPerFt * s.pxPerFt)).toFixed(2),
    cellSF: +(f.count / (mppf * mppf)).toFixed(2),
    sealedPx: f.sealedPx ?? null,
  };
}

const rows: any[] = [];
let flips = 0, worstPct = 0, worst: any = null;
for (let i = 30; i <= 90; i++) {
  const w = i / 100;
  const lo = measure(w, BASE_RS), hi = measure(w, 5.374);
  const same = lo.status === hi.status && (lo.sf === null || Math.abs((hi.sf! - lo.sf!) / lo.sf!) < 0.001);
  if (!same) flips++;
  const pct = lo.sf && hi.sf ? ((hi.sf - lo.sf) / lo.sf) * 100 : 0;
  if (Math.abs(pct) > Math.abs(worstPct)) { worstPct = pct; worst = { slitFt: w, lo, hi }; }
  rows.push({ slitFt: w, offStatus: lo.status, offSF: lo.sf, onStatus: hi.status, onSF: hi.sf, pct: +pct.toFixed(2), agree: same });
}
console.log(JSON.stringify({
  probe: "A1b", nWidths: rows.length,
  mppfOff: rows[0].offSF !== undefined ? measure(0.5, BASE_RS).mppf : null,
  mppfOn: measure(0.5, 5.374).mppf,
  widthsWhereHiResChangesTheAnswer: flips,
  worstDeltaPct: +worstPct.toFixed(2), worst,
  rows,
}, null, 1));
