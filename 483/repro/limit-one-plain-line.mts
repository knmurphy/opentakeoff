// Companion to limit-every-second-line.mts: the same table with ONE row's second line plain (no word in
// the code column) — 144 cases; counts reads that are not 4 rows with nothing skipped.
//   cd <CHECKOUT>/web && node --import tsx <repro>/limit-one-plain-line.mts <CHECKOUT>
import { join, resolve } from "node:path";
const { readScheduleSpans } = await import(join(resolve(process.argv[2] ?? process.cwd()), "web/src/lib/scheduleRead.ts"));
const TH = 17, CW = 8; const X = { KEY: 100, MATERIAL: 220, MANUFACTURER: 520, COLOR: 1000 };
const sp = (str: string, x: number, y: number) => ({ str, x, y, w: str.length * CW, h: TH });
let bad = 0, n = 0;
for (const word of ["OWNER", "SHEEN", "PRIME"]) for (const cells of [1, 2]) for (const s of [28, 31, 34]) for (const pad of [0, 6]) for (const free of [0, 1, 2, 3]) {
  const out = [sp("CODE", X.KEY, 0), sp("MATERIAL", X.MATERIAL, 0), sp("MANUFACTURER", X.MANUFACTURER, 0), sp("COLOR", X.COLOR, 0)];
  let y = 40;
  [["PT-1","PAINT","VENDOR-E","WHITE 601"],["PT-2","PAINT","VENDOR-E","TAUPE 602"],["PT-3","PAINT","VENDOR-E","GREY 603"],["CT-1","CERAMIC TILE","VENDOR-F","WHITE 604"]].forEach(([k,m,f,c], i) => {
    out.push(sp(k, X.KEY, y), sp(m, X.MATERIAL, y), sp(f, X.MANUFACTURER, y), sp(c, X.COLOR, y));
    if (i !== free) out.push(sp(word, X.KEY, y + s));
    out.push(sp("SEMI-GLOSS", X.MATERIAL, y + s)); if (cells === 2) out.push(sp("ACME DIV.", X.MANUFACTURER, y + s));
    y += 2 * s + pad;
  });
  const r = readScheduleSpans(out); n++;
  if (r.rows.length !== 4 || r.skipped) { bad++; if (bad < 4) console.log(word, cells, s, pad, "free", free, JSON.stringify(r.rows.map((x) => x.finish_tag)), r.skipped); }
}
console.log({ n, bad });
