// A3 — the minimum-passage ("seal") path and its own guards.
//
// sealAttempt() has two sanity gates on the seal LADDER: the grown region must
// still satisfy the 30%-of-sheet room-size cap, and its boundary must be >=75%
// real linework (virtualBoundaryFrac <= SEAL_VIRTUAL_MAX). On BEFORE the
// minPassPx PRIMARY path (oneclick.ts:1037-1047) returns its grown region
// immediately, before either gate, and sets neither sealedPx nor virtualFrac —
// so a result the ladder would have refused is returned as a clean measurement
// with nothing for confidence to key on.
//
// Three scenes, all 1000x800 image px at 18 px/ft (mppf 18, minPassRadiusFor=5,
// so the rule closes axis-aligned gaps of <= 10 px = 0.556 ft):
//
//  S1 "oversize-through-a-slot": a 700x350 px room (38.9 x 19.4 ft, 756 SF)
//     whose only opening to the rest of the sheet is a 7.2 px (0.40 ft) slot.
//     The dilated flood lands just under the 30% cap; growRegionBack pushes the
//     final count OVER it. This is the room-size gate, exactly.
//  S2 "dashed-line-as-wall": no walls at all — a DASHED graphic line (6 px on,
//     6 px off) closing off a corner of the sheet. The dilation merges the
//     dashes into a solid barrier, so the flood is bounded by a boundary that is
//     largely synthetic. This is the virtual-boundary gate.
//  S3 "two-doorways": the repo's own corpus fixture — a room with two undrawn
//     cased openings, i.e. the LEGITIMATE use of the rule. Included so the probe
//     shows what the guards cost when they are working correctly.
//
// Reported on both states: flood status, sealedPx, virtualFrac, any min-passage
// provenance the result carries, measured SF, and traceConfidence score+factors.
import {
  buildMask, floodRegion, floodRegionSealed, sealRadiiFor, doorWedgeCapPx,
  minPassRadiusFor, traceRegion, ringArea, MASK_MAX_DIM,
} from "../src/lib/oneclick.ts";
import { traceConfidence } from "../src/lib/confidence.ts";

const W = 1000, H = 800, PXFT = 18;
const L = (s: number[], x0: number, y0: number, x1: number, y1: number) => s.push(x0, y0, x1, y1);

function s1() {                                     // oversize room behind a 0.40 ft slot
  const s: number[] = [];
  L(s, 2, 2, W - 2, 2); L(s, W - 2, 2, W - 2, H - 2); L(s, W - 2, H - 2, 2, H - 2); L(s, 2, H - 2, 2, 2);
  const x0 = 100, y0 = 100, x1 = 800, y1 = 450;     // 700 x 350 px
  const gap = 0.40 * PXFT, cy = (y0 + y1) / 2;      // 7.2 px slot in the EAST wall
  L(s, x0, y0, x1, y0); L(s, x1, y1, x0, y1); L(s, x0, y1, x0, y0);
  L(s, x1, y0, x1, cy - gap / 2); L(s, x1, cy + gap / 2, x1, y1);
  return { segs: s, seed: [450, 275] as [number, number] };
}
function s2() {                                     // dashed graphic line, no walls
  const s: number[] = [];
  L(s, 2, 2, W - 2, 2); L(s, W - 2, 2, W - 2, H - 2); L(s, W - 2, H - 2, 2, H - 2); L(s, 2, H - 2, 2, 2);
  for (let x = 2; x < 400; x += 12) L(s, x, 400, Math.min(x + 6, 400), 400);      // horizontal dashed
  for (let y = 2; y < 400; y += 12) L(s, 400, y, 400, Math.min(y + 6, 400));      // vertical dashed
  return { segs: s, seed: [200, 200] as [number, number] };
}
function s3() {                                     // bench corpus "two-doorways"
  const s: number[] = [];
  L(s, 2, 2, W - 2, 2); L(s, W - 2, 2, W - 2, H - 2); L(s, W - 2, H - 2, 2, H - 2); L(s, 2, H - 2, 2, 2);
  const raw = [20, 20, 50, 20, 57, 20, 100, 20, 100, 20, 100, 100,
    100, 100, 62, 100, 55, 100, 20, 100, 20, 100, 20, 20];
  for (let i = 0; i < raw.length; i += 4) L(s, raw[i], raw[i + 1], raw[i + 2], raw[i + 3]);
  return { segs: s, seed: [60, 60] as [number, number] };
}

const SCENES: Array<[string, ReturnType<typeof s1>]> = [
  ["S1 oversize-through-0.40ft-slot", s1()],
  ["S2 dashed-line-as-wall", s2()],
  ["S3 two-doorways (legitimate)", s3()],
];

const out: any = { probe: "A3", minPassPx: minPassRadiusFor(PXFT), sheetCells: W * H, sizeCap: Math.floor(W * H * 0.30), scenes: [] };
for (const [name, sc] of SCENES) {
  const mo = buildMask(sc.segs, W, H, MASK_MAX_DIM, null, PXFT, PXFT);
  const mppf = mo.mppf || 0;
  const minPass = minPassRadiusFor(mppf);
  const plain: any = floodRegion(mo, sc.seed[0], sc.seed[1], 0.5);
  const f: any = floodRegionSealed(mo, sc.seed[0], sc.seed[1], 0.5, sealRadiiFor(mppf), doorWedgeCapPx(mppf), minPass);
  const row: any = {
    scene: name, mppf, minPassPx: minPass,
    plainFloodStatus: plain.status, plainCount: plain.count ?? null,
    status: f.status,
    sealedPx: f.sealedPx ?? null,
    virtualFrac: f.virtualFrac ?? null,
    // min-passage provenance: present only where the engine emits it
    minPassProvenance: { minPassPx: f.minPassPx ?? null, minPassDelta: f.minPassDelta ?? null },
    wedges: f.wedges ?? null, wedgeGrowth: f.wedgeGrowth ?? null,
    hatchFiltered: f.hatchFiltered ?? null, hatchTier: f.hatchTier ?? null, curveFrac: f.curveFrac ?? null,
  };
  if (f.status === "ok") {
    row.count = f.count;
    row.sheetFrac = +(f.count / (W * H)).toFixed(4);
    row.overSizeCap = f.count > W * H * 0.30;
    const ring = traceRegion(f);
    row.SF = +(ringArea(ring) / (PXFT * PXFT)).toFixed(2);
    row.cellSF = +(f.count / (mppf * mppf)).toFixed(2);
    // every field either state can read; unknown keys are ignored by BEFORE
    const conf = traceConfidence({
      raster: false, hatchFiltered: f.hatchFiltered, hatchTier: f.hatchTier,
      sealedPx: f.sealedPx, virtualFrac: f.virtualFrac, wedges: f.wedges, wedgeGrowth: f.wedgeGrowth,
      curveFrac: f.curveFrac, minPassPx: f.minPassPx, minPassDelta: f.minPassDelta,
      areaSF: ringArea(ring) / (PXFT * PXFT), mppf: f.mppf,
    });
    row.confidence = conf.score; row.factors = conf.factors;
  }
  out.scenes.push(row);
}
console.log(JSON.stringify(out, null, 1));
