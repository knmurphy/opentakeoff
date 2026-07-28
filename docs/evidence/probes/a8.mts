// A8 — what does one hover frame cost on a large multi-door room?
//
// floodRegionSealed runs once per animation frame while the cursor is over a
// new region. The fixture is a 3000 x 3000 working mask (== MASK_MAX_DIM, so
// ws = 1 and this IS the production cap) holding one 30 ft room ringed by six
// drawn door swings — the shape every hovered room on a real plan has, and the
// one the per-arc-cluster retry is slowest on.
//
// Measured, identically on both states:
//   COLD  the first floodRegionSealed on a freshly built mask (empty sealCache)
//   WARM  the next three on the same mask
//   PEAK EXTERNAL  max(process.memoryUsage().external) sampled after each call,
//                  minus the post-gc baseline taken at the top of the trial.
//                  Run with --expose-gc so each trial starts from a collected
//                  heap. This is a SAMPLED peak, not an allocator high-water
//                  mark: it undercounts anything V8 collects mid-call.
//
// TRIALS = 5, and the spread is reported, not one sample.
//
// The probe also digests the region bitmap and the traced ring, because A8 is
// claimed to be a pure performance change: those must be bit-identical.
import {
  buildMask, floodRegionSealed, traceRegion, ringArea,
  sealRadiiFor, doorWedgeCapPx, minPassRadiusFor, SENS_BALANCED, SEG_CURVE,
  type MaskObj,
} from "../src/lib/oneclick.ts";

const PXFT = 18, IMG = 3000, SIDE = 540, DW = 3 * PXFT, R = 3 * PXFT;
const TRIALS = 5, WARM = 3;

function arcChords(cx: number, cy: number, r: number, a0: number, a1: number, steps: number): number[] {
  const s: number[] = [];
  let px = cx + r * Math.cos(a0), py = cy + r * Math.sin(a0);
  for (let k = 1; k <= steps; k++) {
    const a = a0 + (a1 - a0) * (k / steps);
    const qx = cx + r * Math.cos(a), qy = cy + r * Math.sin(a);
    s.push(px, py, qx, qy); px = qx; py = qy;
  }
  return s;
}
function doorScene(doors: number): { mo: MaskObj; seed: [number, number] } {
  const segs: number[] = [], meta: number[] = [];
  const push = (s: number[], curve = false) => {
    for (let i = 0; i + 3 < s.length; i += 4) { segs.push(s[i], s[i + 1], s[i + 2], s[i + 3]); meta.push(curve ? SEG_CURVE : 0); }
  };
  const line = (a: number, b: number, c: number, d: number) => push([a, b, c, d]);
  const X0 = 1500 - SIDE / 2, Y0 = X0, X1 = 1500 + SIDE / 2, Y1 = X1;
  const spots: Array<[number, number]> = [
    [0, 0.25], [0, 0.70], [1, 0.30], [1, 0.75], [2, 0.35], [2, 0.80], [3, 0.40], [3, 0.85],
  ];
  const use = spots.slice(0, doors);
  for (let w = 0; w < 4; w++) {
    const L = SIDE;
    const cuts = use.filter((s) => s[0] === w).map((s) => [s[1] * L - DW / 2, s[1] * L + DW / 2] as [number, number]).sort((a, b) => a[0] - b[0]);
    let at = 0; const runs: Array<[number, number]> = [];
    for (const [a, b] of cuts) { runs.push([at, a]); at = b; }
    runs.push([at, L]);
    for (const [a, b] of runs) {
      if (b <= a) continue;
      if (w === 0) line(X0 + a, Y0, X0 + b, Y0);
      else if (w === 1) line(X1, Y0 + a, X1, Y0 + b);
      else if (w === 2) line(X0 + a, Y1, X0 + b, Y1);
      else line(X0, Y0 + a, X0, Y0 + b);
    }
    for (const [a] of cuts) {
      if (w === 0) { push(arcChords(X0 + a, Y0, R, 0, Math.PI / 2, 12), true); line(X0 + a, Y0, X0 + a, Y0 + R); }
      else if (w === 1) { push(arcChords(X1, Y0 + a, R, Math.PI / 2, Math.PI, 12), true); line(X1, Y0 + a, X1 - R, Y0 + a); }
      else if (w === 2) { push(arcChords(X0 + a, Y1, R, 0, -Math.PI / 2, 12), true); line(X0 + a, Y1, X0 + a, Y1 - R); }
      else { push(arcChords(X0, Y0 + a, R, Math.PI / 2, 0, 12), true); line(X0, Y0 + a, X0 + R, Y0 + a); }
    }
  }
  return { mo: buildMask(segs, IMG, IMG, IMG, Uint8Array.from(meta), PXFT, PXFT), seed: [1500, 1500] };
}
const hover = (mo: MaskObj, seed: [number, number]) => {
  const mppf = mo.mppf || 0;
  return floodRegionSealed(mo, seed[0], seed[1], SENS_BALANCED, sealRadiiFor(mppf), doorWedgeCapPx(mppf), minPassRadiusFor(mppf));
};
function digest(reg: Uint8Array): string {                // FNV-1a over the region bitmap
  let h = 0x811c9dc5, n = 0;
  for (let i = 0; i < reg.length; i++) if (reg[i]) { n++; h = Math.imul(h ^ i, 0x01000193) >>> 0; }
  return `${h.toString(16).padStart(8, "0")}:${n}`;
}
const MB = (b: number) => +(b / 1048576).toFixed(1);
const stats = (a: number[]) => ({ min: +Math.min(...a).toFixed(1), median: +a.slice().sort((x, y) => x - y)[a.length >> 1].toFixed(1), max: +Math.max(...a).toFixed(1), all: a.map((v) => +v.toFixed(1)) });

const out: any = { probe: "A8", mask: `${IMG}x${IMG}`, trials: TRIALS, warmPerTrial: WARM, byDoors: [] };
for (const doors of [0, 1, 6]) {
  const cold: number[] = [], warm: number[] = [], peak: number[] = [];
  let fingerprint: any = null;
  for (let t = 0; t < TRIALS; t++) {
    (globalThis as any).gc?.();
    const base = process.memoryUsage().external;
    let hi = base;
    const { mo, seed } = doorScene(doors);
    hi = Math.max(hi, process.memoryUsage().external);
    const t0 = performance.now();
    const f: any = hover(mo, seed);
    cold.push(performance.now() - t0);
    hi = Math.max(hi, process.memoryUsage().external);
    for (let k = 0; k < WARM; k++) {
      const w0 = performance.now();
      hover(mo, seed);
      warm.push(performance.now() - w0);
      hi = Math.max(hi, process.memoryUsage().external);
    }
    peak.push(hi - base);
    if (!fingerprint && f.status === "ok") {
      const ring = traceRegion(f);
      fingerprint = {
        status: f.status, count: f.count, hardHits: f.hardHits ?? null, softHits: f.softHits ?? null,
        sealedPx: f.sealedPx ?? null, virtualFrac: f.virtualFrac ?? null,
        wedges: f.wedges ?? null, wedgeGrowth: f.wedgeGrowth ?? null,
        digest: digest(f.region), ringLen: ring.length, ringArea: Math.round(ringArea(ring)),
      };
    }
  }
  out.byDoors.push({
    doors, coldMs: stats(cold), warmMs: stats(warm),
    peakExternalMB: stats(peak.map(MB)), fingerprint,
  });
}
console.log(JSON.stringify(out, null, 1));
