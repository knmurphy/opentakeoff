// Research probe (throwaway) — run: node --import tsx docs/evidence/one-click/research/<file>.mts
// Run from anywhere; paths are absolute to this checkout. Not part of `npm run bench`.
// Research probe (throwaway), take 2: what do the plan's own "NNN SF" callouts
// annotate, and what does One-Click read there? Seeds are swept on a small
// grid (the text anchor can land inside stroke-text glyphs), and the modal
// region — what a human clicking in that room would get — is reported with the
// full spread, plus the nearby text that says what the callout labels.
import { createRequire } from "module";
import { readFileSync } from "fs";
import { join } from "path";
import { extractVectorGeometry, buildMask, floodRegionSealed, sealRadiiFor, doorWedgeCapPx, minPassRadiusFor, traceRegion, MASK_MAX_DIM } from "../../../../web/src/lib/oneclick.ts";

const ROOT = "/home/user/opentakeoff";
const req = createRequire(import.meta.url);
const pdfjs = await import(req.resolve("/home/user/opentakeoff/web/node_modules/pdfjs-dist/legacy/build/pdf.mjs"));
const c = JSON.parse(readFileSync(join(ROOT, "web/bench/corpus/va-finish-plan.json"), "utf8"));
const doc = await pdfjs.getDocument({ url: join(ROOT, "web/bench/corpus", c.pdf), useSystemFonts: true }).promise;
const page = await doc.getPage(1);
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
const callouts = items
  .map((it) => ({ it, m: /^([\d,]+)\s*(?:SF|S\.F\.)$/i.exec(it.str.trim()) }))
  .filter((r) => r.m)
  .map((r) => ({ x: r.it.x, y: r.it.y, sf: +r.m![1].replace(/,/g, ""), raw: r.it.str }));

const baseDim = Math.min(MASK_MAX_DIM, Math.max(vp.width, vp.height, 2));
const mo = buildMask(g.segs, vp.width, vp.height, baseDim, g.meta, c.ptPerFt);
const mppf = (mo as { ws: number }).ws * c.ptPerFt;
const pxPerFt = c.ptPerFt;
const OFFS: [number, number][] = [];
for (const dy of [-70, -35, 0, 35, 70]) for (const dx of [-70, -35, 0, 35, 70]) OFFS.push([dx, dy]);

for (const co of callouts) {
  const near = items
    .filter((it) => it.str !== co.raw && Math.hypot(it.x - co.x, it.y - co.y) < 170)
    .map((it) => `"${it.str}"`).slice(0, 6).join(" ");
  const areas: number[] = [];
  let refused = 0;
  for (const off of OFFS) {
    const f = floodRegionSealed(mo, co.x + off[0], co.y + off[1], 0.5, sealRadiiFor(mppf), doorWedgeCapPx(mppf), minPassRadiusFor(mppf));
    if (f.status !== "ok") { refused++; continue; }
    const r = traceRegion(f as never) as unknown as number[][];
    if (!r || r.length < 3) { refused++; continue; }
    let a = 0;
    for (let i = 0; i < r.length; i++) { const [x1, y1] = r[i], [x2, y2] = r[(i + 1) % r.length]; a += x1 * y2 - x2 * y1; }
    areas.push(Math.abs(a / 2) / (pxPerFt * pxPerFt));
  }
  // modal cluster: group areas within 5% of each other, keep the biggest group
  const groups: { rep: number; members: number[] }[] = [];
  for (const a of areas) {
    const grp = groups.find((gp) => Math.abs(gp.rep - a) <= 0.05 * Math.max(gp.rep, a, 1));
    if (grp) grp.members.push(a); else groups.push({ rep: a, members: [a] });
  }
  groups.sort((a, b) => b.members.length - a.members.length);
  const mode = groups[0];
  const modeSf = mode ? mode.members.reduce((x, y) => x + y, 0) / mode.members.length : NaN;
  const err = (modeSf - co.sf) / co.sf;
  console.log(`\n${co.raw}  @(${co.x},${co.y})  nearby: ${near || "(none)"}`);
  console.log(`  seeds ${OFFS.length}: ok ${areas.length}, refused ${refused} | modal region ${isNaN(modeSf) ? "n/a" : modeSf.toFixed(0) + " SF"} (${mode?.members.length ?? 0}/${OFFS.length} seeds)  err vs callout ${isNaN(err) ? "n/a" : (err * 100).toFixed(1) + "%"}`);
  console.log(`  distinct regions: ${groups.slice(0, 6).map((gp) => `${gp.rep.toFixed(0)}SF×${gp.members.length}`).join("  ")}`);
}
