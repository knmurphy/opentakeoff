// Diff the stored (seam-merged) page-read lines of two runs, split at a y in image px.
//   node diffl.mjs a-words.json b-words.json <ySplit>
import { readFileSync } from "node:fs";
const lines = (p) => Object.values(JSON.parse(readFileSync(p, "utf8")).stored)[0].lines;
const [pa, pb, ys] = process.argv.slice(2); const Y = Number(ys);
const a = lines(pa), b = lines(pb);
const txt = (l) => l.str ?? l.text ?? (l.words ?? []).map((w) => w.str).join(" ");
const yy = (l) => l.y ?? l.words?.[0]?.y ?? 0;
for (const [name, keep] of [["above", (l) => yy(l) < Y], ["band", (l) => yy(l) >= Y]]) {
  const A = a.filter(keep), B = b.filter(keep);
  const count = (xs) => xs.reduce((m, l) => m.set(txt(l), (m.get(txt(l)) ?? 0) + 1), new Map());
  const ca = count(A), cb = count(B);
  const only = (x, y) => [...x].flatMap(([s, n]) => Array(Math.max(0, n - (y.get(s) ?? 0))).fill(s));
  const oa = only(ca, cb), ob = only(cb, ca);
  console.log(`== ${name} y${name === "above" ? "<" : ">="}${Y}: main ${A.length} lines, branch ${B.length}; identical ${A.length - oa.length}; main-only ${oa.length}; branch-only ${ob.length}`);
  for (const s of oa) console.log("  - " + JSON.stringify(s));
  for (const s of ob) console.log("  + " + JSON.stringify(s));
}
