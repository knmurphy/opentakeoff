// Per-ink exact-match recall of a page read against the answer key.
//   node score.mjs ink481-key.json out/main-words.json [out/branch-words.json ...]
// A code counts as read when some OCR word, trimmed, equals it exactly.
import { readFileSync } from "node:fs";
const [keyPath, ...runs] = process.argv.slice(2);
const key = JSON.parse(readFileSync(keyPath, "utf8"));
const rows = {};
for (const run of runs) {
  const { replies } = JSON.parse(readFileSync(run, "utf8"));
  const words = new Set(replies.flatMap((r) => r.words.map((w) => w.str.trim())));
  for (const [ink, codes] of Object.entries(key)) {
    const by = [0, 10, 20].map((i) => codes.slice(i, i + 10).filter((c) => words.has(c)).length);
    (rows[ink] ??= []).push(`${by[0] + by[1] + by[2]}/${codes.length} (${by.join("+")})`);
  }
}
console.log(["ink", ...runs.map((r) => r.split("/").pop().replace("-words.json", ""))].join(" | "));
for (const [ink, cols] of Object.entries(rows)) console.log([ink, ...cols].join(" | "));
