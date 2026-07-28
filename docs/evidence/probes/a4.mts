// A4 — does a curved WALL get a door swing's growth allowance?
//
// The door-swing retry opens one boundary arc cluster at a time and keeps the
// re-flood if its growth fits an allowance. On BEFORE the allowance is the
// cluster's bounding box + rim, hard-capped at 2 x doorWedgeCapPx — a CONSTANT
// (2 x a 5 ft leaf's wedge = 16,540 cells = 51.0 SF at 18 px/ft), independent of
// what the arc actually is. So any arc that happens to have <= 51 SF behind it
// hands that floor to the room, door or not.
//
// SCENE (1000 x 800 image px, 18 px/ft, mppf 18, NO DOOR ANYWHERE):
//   A rectangular room (100,100)-(400,640) — 16.7 x 30.0 ft — whose east side is
//   a straight wall at x=400. Inside it, a CURVED WALL runs from (400,100) to
//   (400,640): a 30.0 ft chord bulging 2.5 ft (45 px) west, tessellated into 16
//   chords all carrying SEG_CURVE. The crescent between the arc and the straight
//   wall is a separate space of exactly 2/3 x 45 x 540 = 16,200 px = 50.0 SF.
//   Seed in the main room, west of the arc.
//
//   Control scene: the same room with a real 3'-0" door swing instead of the
//   curved wall, so the probe also shows what the change costs a genuine door.
//
// Reported on both states: region cell count with the wedge retry OFF
// (wedgeCapPx = 0) and ON, the annexed SF, `wedges`, and traceConfidence.
import {
  buildMask, floodRegionSealed, sealRadiiFor, doorWedgeCapPx, minPassRadiusFor,
  traceRegion, ringArea, MASK_MAX_DIM, SEG_CURVE,
} from "../src/lib/oneclick.ts";
import { traceConfidence } from "../src/lib/confidence.ts";

const W = 1000, H = 800, PXFT = 18;
const N_CHORDS = 16;

function curvedWallScene() {
  const segs: number[] = [], curve: boolean[] = [];
  const push = (x0: number, y0: number, x1: number, y1: number, c = false) => { segs.push(x0, y0, x1, y1); curve.push(c); };
  push(2, 2, W - 2, 2); push(W - 2, 2, W - 2, H - 2); push(W - 2, H - 2, 2, H - 2); push(2, H - 2, 2, 2);
  push(100, 100, 400, 100); push(400, 100, 400, 640); push(400, 640, 100, 640); push(100, 640, 100, 100);
  // 30 ft chord (540 px) from (400,100) to (400,640), 2.5 ft (45 px) sagitta west
  let px = 400, py = 100;
  for (let k = 1; k <= N_CHORDS; k++) {
    const t = k / N_CHORDS;
    const qy = 100 + t * 540, qx = 400 - Math.sin(t * Math.PI) * 45;
    push(px, py, qx, qy, true); px = qx; py = qy;
  }
  return { segs, curve, seed: [200, 370] as [number, number], label: "curved wall 30.0 ft chord / 2.5 ft bulge, NO door" };
}

function doorScene() {
  const segs: number[] = [], curve: boolean[] = [];
  const push = (x0: number, y0: number, x1: number, y1: number, c = false) => { segs.push(x0, y0, x1, y1); curve.push(c); };
  push(2, 2, W - 2, 2); push(W - 2, 2, W - 2, H - 2); push(W - 2, H - 2, 2, H - 2); push(2, H - 2, 2, 2);
  const R = 54;                                   // 3'-0"
  push(100, 100, 400, 100);
  push(400, 100, 400, 340); push(400, 340 + R, 400, 640);   // 3 ft opening in the east wall
  push(400, 640, 100, 640); push(100, 640, 100, 100);
  push(400, 340, 400 - R, 340);                   // leaf, swinging into the room
  let px = 400 - R, py = 340;
  for (let k = 1; k <= 8; k++) {
    const a = (k / 8) * (Math.PI / 2);
    const qx = 400 - R * Math.cos(a), qy = 340 + R * Math.sin(a);
    push(px, py, qx, qy, true); px = qx; py = qy;
  }
  push(400, 100, 700, 100); push(700, 100, 700, 640); push(700, 640, 400, 640);   // neighbour space east
  return { segs, curve, seed: [200, 370] as [number, number], label: "control: real 3'-0\" door swing" };
}

function run(sc: ReturnType<typeof curvedWallScene>) {
  const meta = new Uint8Array(sc.curve.length);
  for (let i = 0; i < sc.curve.length; i++) if (sc.curve[i]) meta[i] = SEG_CURVE;
  const mo = buildMask(sc.segs, W, H, MASK_MAX_DIM, meta, PXFT, PXFT);
  const mppf = mo.mppf || 0;
  const cap = doorWedgeCapPx(mppf);
  const mk = (wedgeCap: number) => {
    const f: any = floodRegionSealed(mo, sc.seed[0], sc.seed[1], 0.5, sealRadiiFor(mppf), wedgeCap, minPassRadiusFor(mppf));
    if (f.status !== "ok") return { status: f.status };
    const ring = traceRegion(f);
    const sf = ringArea(ring) / (PXFT * PXFT);
    const conf = traceConfidence({
      raster: false, hatchFiltered: f.hatchFiltered, hatchTier: f.hatchTier, sealedPx: f.sealedPx,
      virtualFrac: f.virtualFrac, wedges: f.wedges, wedgeGrowth: f.wedgeGrowth, curveFrac: f.curveFrac,
      minPassPx: f.minPassPx, minPassDelta: f.minPassDelta, areaSF: sf, mppf: f.mppf,
    });
    return {
      status: "ok", count: f.count, SF: +sf.toFixed(2), cellSF: +(f.count / (mppf * mppf)).toFixed(2),
      wedges: f.wedges ?? null, wedgeGrowth: f.wedgeGrowth ?? null, curveFrac: f.curveFrac ?? null,
      confidence: conf.score, factors: conf.factors,
    };
  };
  const off = mk(0), on = mk(cap);
  return {
    scene: sc.label, mppf, doorWedgeCapPx: cap, allowanceCells: 2 * cap, allowanceSF: +((2 * cap) / (mppf * mppf)).toFixed(2),
    wedgeRetryOFF: off, wedgeRetryON: on,
    annexedCells: off.status === "ok" && on.status === "ok" ? (on as any).count - (off as any).count : null,
    annexedSF: off.status === "ok" && on.status === "ok" ? +(((on as any).count - (off as any).count) / (mppf * mppf)).toFixed(2) : null,
  };
}

console.log(JSON.stringify({ probe: "A4", results: [run(curvedWallScene()), run(doorScene())] }, null, 1));
