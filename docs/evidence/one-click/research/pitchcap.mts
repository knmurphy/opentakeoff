// Research probe (throwaway) — run: node --import tsx docs/evidence/one-click/research/<file>.mts
// Run from anywhere; paths are absolute to this checkout. Not part of `npm run bench`.
// Research probe (throwaway): is the hatch pitch cap a usable per-project knob
// (design doc §4's `hatch_max_pitch_ft`)? Sweep the cap over the synthetic
// corpus and report (a) how many segments classify as hatch, (b) end-to-end
// IoU vs each fixture's golden. The two round-8 known-fails are pitch-band
// ambiguities; this measures whether ANY cap separates them from the real
// hatch fixtures.
import { buildMask, classifyHatchSegs, floodRegionSealed, sealRadiiFor, doorWedgeCapPx, minPassRadiusFor, traceRegion, MASK_MAX_DIM, HATCH_MAX_PITCH_FT } from "../../../../web/src/lib/oneclick.ts";
import { syntheticCorpus } from "../../../../web/bench/corpus.ts";
import { polyIoU } from "../../../../web/bench/score.ts";

const CAPS_FT = [0.5, 0.75, 0.9, 1.0, 1.1, 1.25, 4 / 3, 1.5, 2.0];
const WATCH = new Set(["hatched-room", "tile-grid-room", "partition-bank-15in", "tile-demising-same-pen", "annotation-ring-room"]);

console.log(`shipped HATCH_MAX_PITCH_FT = ${(HATCH_MAX_PITCH_FT).toFixed(4)} ft (${(HATCH_MAX_PITCH_FT * 12).toFixed(1)}")\n`);
console.log("== (a) classification: segments flagged hatch, per cap (soft/total) ==");
const cases = syntheticCorpus();
for (const c of cases) {
  if (!WATCH.has(c.name)) continue;
  if (!c.meta) { console.log(`${c.name}: no meta`); continue; }
  const ws = Math.min(1, MASK_MAX_DIM / Math.max(c.imgW, c.imgH, 1));
  const mppf = c.ptPerFt * ws;
  const total = c.segs.length >> 2;
  const row = CAPS_FT.map((capFt) => {
    const soft = classifyHatchSegs(c.segs, c.meta!, ws, capFt * mppf);
    let n = 0; for (const v of soft) if (v) n++;
    return `${capFt.toFixed(2)}:${n}`;
  }).join("  ");
  console.log(`${c.name.padEnd(24)} total ${String(total).padStart(4)} | ${row}`);
}

console.log("\n== (b) end-to-end IoU vs golden, per cap ==");
console.log("   (cap simulated by scaling the px/ft handed to buildMask; the flood's own");
console.log("    radii/wedge/min-pass params keep the TRUE scale, so only the cap moves)");
for (const c of cases) {
  const probes = c.probes.filter((p) => p.expect === "golden");
  if (!probes.length) continue;
  const trueWs = Math.min(1, MASK_MAX_DIM / Math.max(c.imgW, c.imgH, 1));
  const trueMppf = c.ptPerFt * trueWs;
  const cells: string[] = [];
  for (const capFt of CAPS_FT) {
    const fakePxPerFt = (capFt / HATCH_MAX_PITCH_FT) * c.ptPerFt;   // cap = HATCH_MAX_PITCH_FT * fakePxPerFt * ws
    const mo = buildMask(c.segs, c.imgW, c.imgH, MASK_MAX_DIM, c.meta ?? null, fakePxPerFt);
    let worst = 1;
    for (const p of probes) {
      const f = floodRegionSealed(mo, p.seed[0], p.seed[1], 0.5, sealRadiiFor(trueMppf), doorWedgeCapPx(trueMppf), minPassRadiusFor(trueMppf));
      const ring = f.status === "ok" ? traceRegion(f as never) : null;
      const iou = ring && ring.length >= 3 ? polyIoU(ring as never, p.golden!, 1) : 0;
      worst = Math.min(worst, iou);
    }
    cells.push(`${capFt.toFixed(2)}:${worst.toFixed(3)}`);
  }
  const flag = WATCH.has(c.name) ? " *" : "";
  console.log(`${(c.name + flag).padEnd(26)} ${cells.join("  ")}`);
}
