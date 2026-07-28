// Research probe (throwaway) — run: node --import tsx docs/evidence/one-click/research/seeding-after-filter.mts
// Run from anywhere; paths are absolute to this checkout. Not part of `npm run bench`.
//
// Item F seeding, re-measured AFTER label filtering (issue #184 round 9). The
// first head-to-head ran with 56 seeds, 15 of which were not rooms — so part
// of the sweep's cost was spent flooding the paper margin, and part of its
// apparent win was recovering rooms the junk labels had polluted. This asks
// the question again against the seeds the shipped filter actually produces.
//
//   baseline  seed = the text anchor (what ships)
//   A         seed offset BELOW the tag's text box (one flood per label)
//   B         3x3 sweep at +/-4 ft, modal region wins (9 floods per label)
import { createRequire } from "module";
import { readFileSync } from "fs";
import { join } from "path";
import {
  extractVectorGeometry, buildMask, floodRegionSealed, sealRadiiFor, doorWedgeCapPx,
  minPassRadiusFor, traceRegion, MASK_MAX_DIM, SENS_BALANCED, type Point,
} from "../../../../web/src/lib/oneclick.ts";
import { roomLabelSeeds, sheetBounds } from "../../../../web/src/lib/detectRooms.ts";
import { batchMetrics, batchCoverage, batchReach, type Proposal } from "../../../../web/bench/batch.ts";
import { polyIoU, ringAreaAbs } from "../../../../web/bench/score.ts";

const ROOT = "/home/user/opentakeoff";
const CASE = process.env.CASE || "va-finish-plan";
const req = createRequire(import.meta.url);
const pdfjs = await import(req.resolve("/home/user/opentakeoff/web/node_modules/pdfjs-dist/legacy/build/pdf.mjs"));

const c = JSON.parse(readFileSync(join(ROOT, "web/bench/corpus", CASE + ".json"), "utf8"));
const doc = await pdfjs.getDocument({ url: join(ROOT, "web/bench/corpus", c.pdf), useSystemFonts: true }).promise;
const page = await doc.getPage(c.page || 1);
const vp = page.getViewport({ scale: c.scale });
const ops = await page.getOperatorList();
const g = extractVectorGeometry(ops, vp.transform, pdfjs.OPS);
const tc = await page.getTextContent();

// keep the text item's box, which variant A needs
interface Item { str: string; x: number; y: number; w: number; h: number }
const items: Item[] = [];
for (const it of tc.items as Array<{ str?: string; transform: number[]; width?: number; height?: number }>) {
  const str = it.str || "";
  if (!str.trim()) continue;
  const t = pdfjs.Util.transform(vp.transform, it.transform);
  items.push({ str, x: +t[4].toFixed(1), y: +t[5].toFixed(1), w: (it.width || 0) * c.scale, h: (it.height || 0) * c.scale });
}
const boxOf = new Map(items.map((it) => [`${it.x},${it.y}`, it]));

const pxPerFt = c.ptPerFt;
const baseDim = Math.min(MASK_MAX_DIM, Math.max(vp.width, vp.height, 2));
const mo = buildMask(g.segs, vp.width, vp.height, baseDim, g.meta, pxPerFt);
const mppf = mo.ws * pxPerFt;
const radii = sealRadiiFor(mppf), wedgeCap = doorWedgeCapPx(mppf), minPass = minPassRadiusFor(mppf);
let floods = 0;

function ringAt(x: number, y: number): Point[] | null {
  floods++;
  const f = floodRegionSealed(mo, x, y, SENS_BALANCED, radii, wedgeCap, minPass);
  if (f.status !== "ok") return null;
  const r = traceRegion(f) as Point[] | null;
  return r && r.length >= 3 ? r : null;
}
const sfOf = (r: Point[]) => ringAreaAbs(r) / (pxPerFt * pxPerFt);

const seeds = roomLabelSeeds(items, { bounds: sheetBounds(vp.width, vp.height) });
console.log(`${CASE}: ${items.length} text items → ${seeds.length} filtered room-tag seeds · mask ${mppf.toFixed(2)} px/ft\n`);

const goldenProbes = (c.probes as Array<{ name: string; expect: string; golden?: Point[]; knownFail?: boolean }>)
  .filter((p) => p.expect === "golden" && !p.knownFail && p.golden);
const goldens = goldenProbes.map((p) => p.golden!);
const known = goldenProbes.map((p) => ({ name: p.name, ring: p.golden! }));

const variants: Record<string, (s: { str: string; seed: [number, number] }) => Point[] | null> = {
  baseline: (s) => ringAt(s.seed[0], s.seed[1]),

  // A — below the tag's text box. The box drawn AROUND the tag extends only a
  // few px under the baseline, so downward is the direction that escapes it;
  // offsetting by the text WIDTH stays inside (the box is ~2.6x the run).
  A: (s) => {
    const it = boxOf.get(`${s.seed[0]},${s.seed[1]}`);
    const h = it && it.h > 0 ? it.h : 0.5 * pxPerFt;
    return ringAt(s.seed[0], s.seed[1] + 1.5 * h);
  },

  // B — 3x3 sweep, modal region. Density buys nothing (3x3 == 7x7 in the
  // earlier eval); the reach is what matters.
  B: (s) => {
    const r = 4 * pxPerFt;
    const rings: Point[] = [];
    const areas: number[] = [];
    for (const dy of [-r, 0, r]) for (const dx of [-r, 0, r]) {
      const ring = ringAt(s.seed[0] + dx, s.seed[1] + dy);
      if (!ring) continue;
      rings.push(ring as never);
      areas.push(sfOf(ring));
    }
    if (!rings.length) return null;
    const idx = areas.map((_, i) => i).sort((i, j) => areas[i] - areas[j]);
    let best: number[] = [], run: number[] = [];
    for (const i of idx) {
      if (run.length && Math.abs(areas[run[run.length - 1]] - areas[i]) > 0.05 * Math.max(areas[i], 1)) run = [];
      run.push(i);
      if (run.length > best.length) best = [...run];
    }
    return rings[best[Math.floor(best.length / 2)]] as never;
  },
};

for (const [name, fn] of Object.entries(variants)) {
  floods = 0;
  const t0 = process.hrtime.bigint();
  const proposals: Proposal[] = [];
  for (const s of seeds) {
    const ring = fn(s);
    if (ring) proposals.push({ label: s.str, seed: s.seed, ring });
  }
  const secs = Number(process.hrtime.bigint() - t0) / 1e9;
  const m = batchMetrics(proposals, seeds.length, pxPerFt);
  const cov = batchCoverage(proposals, known, pxPerFt);
  const reach = batchReach(proposals, goldens, seeds.map((s) => s.seed), (a, b) => polyIoU(a, b, 8));
  console.log(`── ${name} ──`);
  console.log(`   proposals ${m.proposals}/${seeds.length} · median ${m.medianSF.toFixed(0)} SF · min ${m.minSF.toFixed(0)} / max ${m.maxSF.toFixed(0)} · sub-4-SF ${m.tiny.length}`);
  console.log(`   Σ ${m.sumProposedSF.toFixed(0)} SF · double-counted ${(m.overlapFrac * 100).toFixed(1)}% · duplicates ${m.duplicates.length} · nested ${m.nested.length}`);
  console.log(`   known-floor coverage ${(cov.frac * 100).toFixed(1)}% (${cov.coveredSF.toFixed(0)}/${cov.knownSF.toFixed(0)} SF) · recall ${reach.recallHalf}/${reach.goldens} at ≥0.5, ${reach.recallNine}/${reach.goldens} at ≥0.9`);
  console.log(`   ${floods} floods, ${secs.toFixed(1)} s  (${(secs / Math.max(1, floods) * 1000).toFixed(0)} ms/flood)\n`);
}
