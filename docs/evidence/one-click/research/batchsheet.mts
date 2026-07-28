// Research probe (throwaway) — run: node --import tsx docs/evidence/one-click/research/<file>.mts
// Run from anywhere; paths are absolute to this checkout. Not part of `npm run bench`.
// Research probe (throwaway): what would a batch-fill PASS over the VA sheet
// actually propose? Room-level accounting that needs no human answer key:
//   - how many room-number labels seed a clean region
//   - total proposed floor, and how much of it is DOUBLE-COUNTED (two
//     proposals covering the same cells) — the metric the bench already gates
//     on human-measured cases
//   - whether the pinned goldens even contain a label seed (is tag-seeding a
//     viable seeding strategy, or do anchors land outside the room?)
import { createRequire } from "module";
import { readFileSync } from "fs";
import { join } from "path";
import { extractVectorGeometry, buildMask, floodRegion, floodRegionSealed, sealRadiiFor, doorWedgeCapPx, minPassRadiusFor, traceRegion, MASK_MAX_DIM, SENS_BALANCED } from "../../../../web/src/lib/oneclick.ts";
import { roomLabelSeeds } from "../../../../web/src/lib/detectRooms.ts";

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
const items: { str: string; x: number; y: number }[] = [];
for (const it of tc.items as { str?: string; transform: number[] }[]) {
  const s = it.str || "";
  if (!s.trim()) continue;
  const t = pdfjs.Util.transform(vp.transform, it.transform);
  items.push({ str: s, x: +t[4].toFixed(1), y: +t[5].toFixed(1) });
}
const baseDim = Math.min(MASK_MAX_DIM, Math.max(vp.width, vp.height, 2));
const mo = buildMask(g.segs, vp.width, vp.height, baseDim, g.meta, c.ptPerFt);
const mppf = (mo as { ws: number }).ws * c.ptPerFt;
const pxPerFt = c.ptPerFt;
const seeds = roomLabelSeeds(items);
console.log(`${CASE}: ${items.length} text items · ${seeds.length} room-number labels · mask ${mppf.toFixed(2)} px/ft`);

const inPoly = (x: number, y: number, poly: number[][]) => {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
};
const CELL = 12;                                   // image px ≈ 0.67 ft at 18 px/ft
const cellSF = (CELL / pxPerFt) ** 2;
function cellsOf(ring: number[][]): Set<number> {
  const xs = ring.map((p) => p[0]), ys = ring.map((p) => p[1]);
  const x0 = Math.floor(Math.min(...xs) / CELL), x1 = Math.ceil(Math.max(...xs) / CELL);
  const y0 = Math.floor(Math.min(...ys) / CELL), y1 = Math.ceil(Math.max(...ys) / CELL);
  const out = new Set<number>();
  for (let gy = y0; gy <= y1; gy++) for (let gx = x0; gx <= x1; gx++) {
    if (inPoly(gx * CELL + CELL / 2, gy * CELL + CELL / 2, ring)) out.add(gy * 100000 + gx);
  }
  return out;
}

for (const [label, sealed] of [["raw floodRegion (shipped detectRegions)", false], ["floodRegionSealed (click-path parity)", true]] as const) {
  const rings: { str: string; ring: number[][]; sf: number }[] = [];
  let leak = 0, tiny = 0, other = 0;
  for (const s of seeds) {
    const f = sealed
      ? floodRegionSealed(mo, s.seed[0], s.seed[1], SENS_BALANCED, sealRadiiFor(mppf), doorWedgeCapPx(mppf), minPassRadiusFor(mppf))
      : floodRegion(mo, s.seed[0], s.seed[1], SENS_BALANCED);
    if (f.status !== "ok") { if (f.status === "leak") leak++; else if (f.status === "tiny") tiny++; else other++; continue; }
    const r = traceRegion(f as never) as unknown as number[][];
    if (!r || r.length < 3) { other++; continue; }
    let a = 0;
    for (let i = 0; i < r.length; i++) { const [x1, y1] = r[i], [x2, y2] = r[(i + 1) % r.length]; a += x1 * y2 - x2 * y1; }
    rings.push({ str: s.str, ring: r, sf: Math.abs(a / 2) / (pxPerFt * pxPerFt) });
  }
  const count = new Map<number, number>();
  for (const r of rings) for (const k of cellsOf(r.ring)) count.set(k, (count.get(k) || 0) + 1);
  let covered = 0, dbl = 0, dblCells = 0;
  for (const v of count.values()) { covered++; if (v >= 2) { dbl += (v - 1); dblCells++; } }
  const sum = rings.reduce((a, r) => a + r.sf, 0);
  rings.sort((a, b) => b.sf - a.sf);
  console.log(`\n── ${label} ──`);
  console.log(`  proposals ${rings.length}/${seeds.length}  (leak ${leak}, tiny ${tiny}, other ${other})`);
  console.log(`  Σ proposed ${sum.toFixed(0)} SF | distinct floor covered ${(covered * cellSF).toFixed(0)} SF | DOUBLE-COUNTED ${(dbl * cellSF).toFixed(0)} SF (${((dbl * cellSF) / sum * 100).toFixed(1)}% of proposed, ${dblCells} cells)`);
  console.log(`  largest proposals: ${rings.slice(0, 6).map((r) => `${r.str}=${r.sf.toFixed(0)}SF`).join(", ")}`);
  console.log(`  smallest: ${rings.slice(-4).map((r) => `${r.str}=${r.sf.toFixed(0)}SF`).join(", ")}`);
}

// do the pinned goldens even contain a label seed?
console.log("\n── is tag-seeding viable? (does a room-number label anchor land inside the pinned golden?) ──");
for (const p of (c.probes as { name: string; expect: string; golden?: number[][]; seed: number[] }[])) {
  if (p.expect !== "golden" || !p.golden) continue;
  const hits = seeds.filter((s) => inPoly(s.seed[0], s.seed[1], p.golden!));
  console.log(`  ${p.name.padEnd(26)} labels inside golden: ${hits.length ? hits.map((h) => h.str).join(",") : "NONE"}`);
}
