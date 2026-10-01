// Synthetic check of one known limit: a table whose every row runs to a second line that
// starts, in the code column, with a four- or five-letter word. Same layout as
// web/test/letters483.test.ts's twoLineRows (CODE | MATERIAL | MANUFACTURER | COLOR, 17 px
// text, two lines `s` px apart, `pad` px between rows), except EVERY row's second line
// starts with the word. Reads it with one checkout's readScheduleSpans.
//
//   cd <CHECKOUT>/web && node --import tsx <repro>/limit-every-second-line.mts <CHECKOUT>
import { join, resolve } from "node:path";

const ROOT = resolve(process.argv[2] ?? process.cwd());
const { readScheduleSpans } = await import(join(ROOT, "web/src/lib/scheduleRead.ts"));
const TH = 17, CW = 8;
const X: Record<string, number> = { KEY: 100, MATERIAL: 220, MANUFACTURER: 520, COLOR: 1000 };
const sp = (str: string, x: number, y: number) => ({ str, x, y, w: str.length * CW, h: TH });

function table(word: string, cells: 1 | 2, s: number, pad: number) {
  const out = [sp("CODE", X.KEY, 0), sp("MATERIAL", X.MATERIAL, 0), sp("MANUFACTURER", X.MANUFACTURER, 0), sp("COLOR", X.COLOR, 0)];
  let y = 40;
  for (const [k, mat, mfr, color] of [["PT-1", "PAINT", "VENDOR-E", "WHITE 601"], ["PT-2", "PAINT", "VENDOR-E", "TAUPE 602"], ["PT-3", "PAINT", "VENDOR-E", "GREY 603"], ["CT-1", "CERAMIC TILE", "VENDOR-F", "WHITE 604"]]) {
    out.push(sp(k, X.KEY, y), sp(mat, X.MATERIAL, y), sp(mfr, X.MANUFACTURER, y), sp(color, X.COLOR, y));
    out.push(sp(word, X.KEY, y + s), sp("SEMI-GLOSS", X.MATERIAL, y + s));
    if (cells === 2) out.push(sp("ACME DIV.", X.MANUFACTURER, y + s));
    y += 2 * s + pad;
  }
  return out;
}

const res: Record<string, unknown> = {};
let cases = 0, lost = 0;
for (const word of ["OWNER", "SHEEN", "FIELD", "PRIME"]) for (const cells of [1, 2] as const) for (const s of [28, 31, 34]) for (const pad of [0, 6]) {
  const r = readScheduleSpans(table(word, cells, s, pad));
  const rows = r.rows.map((x: { finish_tag: string; description: string; manufacturer: string }) => `${x.finish_tag}=${x.description}${x.manufacturer ? ` | ${x.manufacturer}` : ""}`);
  const keptAll = ["PT-1", "PT-2", "PT-3", "CT-1"].every((k) => r.rows.some((x: { finish_tag: string; description: string }) => x.finish_tag === k && /SEMI-GLOSS/.test(x.description)));
  cases++; if (!keptAll || r.rows.length !== 4 || r.skipped) lost++;
  res[`${word} ${cells}cell s${s} pad${pad}`] = { rows, ...(r.skipped ? { skipped: r.skipped } : {}), ...("refused" in r ? { refused: r.refused } : {}) };
}
console.log(JSON.stringify({ checkout: process.env.CHECKOUT_LABEL ?? "checkout", cases, notAsWraps: lost, sample: Object.fromEntries(Object.entries(res).slice(0, 4)), all: res }, null, 1));
