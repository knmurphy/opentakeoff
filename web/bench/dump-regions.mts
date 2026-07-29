// One-off: trace what One-Click actually measures at the 3 stable corridor
// callouts, so the region can be drawn on the plan (bug vs one-segment).
import { createRequire } from "module";
import { readFileSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { extractVectorGeometry, buildMask, floodRegionSealed, sealRadiiFor, doorWedgeCapPx, minPassRadiusFor, traceRegion, MASK_MAX_DIM } from "../src/lib/oneclick.ts";
import { parseAreaCallouts, sweepOffsetsFor, type TextItem } from "./callouts.ts";

const here = dirname(fileURLToPath(import.meta.url));
const req = createRequire(import.meta.url);
const pdfjs = await import(req.resolve("pdfjs-dist/legacy/build/pdf.mjs"));
const c = JSON.parse(readFileSync(join(here, "corpus", "va-finish-plan.json"), "utf8"));
const doc = await pdfjs.getDocument({ url: join(here, "corpus", c.pdf), useSystemFonts: true }).promise;
const page = await doc.getPage(c.page || 1);
const vp = page.getViewport({ scale: c.scale });
const g = extractVectorGeometry(await page.getOperatorList(), vp.transform, pdfjs.OPS);
const tc = await page.getTextContent();
const items: TextItem[] = [];
for (const it of tc.items as Array<{ str?: string; transform: number[] }>) {
  if (!(it.str || "").trim()) continue;
  const t = pdfjs.Util.transform(vp.transform, it.transform);
  items.push({ str: it.str!, x: +t[4].toFixed(1), y: +t[5].toFixed(1) });
}
const callouts = parseAreaCallouts(items);
const pxPerFt = c.ptPerFt;
const baseDim = Math.min(MASK_MAX_DIM, Math.max(vp.width, vp.height, 2));
const mo = buildMask(g.segs, vp.width, vp.height, baseDim, g.meta, pxPerFt);
const mppf = mo.ws * pxPerFt;
const radii = sealRadiiFor(mppf), wedgeCap = doorWedgeCapPx(mppf), minPass = minPassRadiusFor(mppf);

const ringAt = (x: number, y: number): { sf: number; ring: number[][] } | null => {
  const f = floodRegionSealed(mo, x, y, 0.5, radii, wedgeCap, minPass);
  if (f.status !== "ok") return null;
  const r = traceRegion(f);
  if (!r || r.length < 3) return null;
  let a = 0;
  for (let i = 0; i < r.length; i++) { const [x1, y1] = r[i], [x2, y2] = r[(i + 1) % r.length]; a += x1 * y2 - x2 * y1; }
  return { sf: Math.abs(a / 2) / (pxPerFt * pxPerFt), ring: r };
};

const targets: [number, number][] = [[270, 152], [189, 143], [640, 392]];  // [printed, modal engine SF]
const out: any[] = [];
for (const [printed, modal] of targets) {
  const co = callouts.find((k) => k.sf === printed)!;
  const found: { sf: number; ring: number[][] }[] = [];
  for (const [dx, dy] of sweepOffsetsFor(pxPerFt, co.sf)) {
    const r = ringAt(co.x + dx, co.y + dy);
    if (r) found.push(r);
  }
  const pick = found.reduce<{ sf: number; ring: number[][] } | null>((b, r) => (!b || Math.abs(r.sf - modal) < Math.abs(b.sf - modal) ? r : b), null);
  const max = found.reduce<{ sf: number; ring: number[][] } | null>((b, r) => (!b || r.sf > b.sf ? r : b), null);
  out.push({ printed, anchor: [co.x, co.y], sf: pick?.sf ?? null, ring: pick?.ring ?? [], maxSf: max?.sf ?? null });
  console.log(`printed ${printed}: modal ${pick?.sf?.toFixed(0)} SF (${pick?.ring.length} verts), leak-max ${max?.sf?.toFixed(0)} SF, ${found.length} ok seeds`);
}
writeFileSync("/tmp/stable-regions.json", JSON.stringify({ scale: c.scale, page: c.page || 1, regions: out }));
