// Prints the contrast table from run.mjs logs (the CONTRAST line).
//   node contrast-table.mjs out/run-head.log out/run-base.log
import { readFileSync } from "node:fs";
const pick = (f) => JSON.parse(readFileSync(f, "utf8").split("\n").find((l) => l.startsWith("CONTRAST ")).slice(9));
const head = pick(process.argv[2]), base = process.argv[3] ? pick(process.argv[3]) : {};
const looks = Object.keys(head);
const r = (m) => (m ? m.ratio.toFixed(2) : "—");
const rows = [
  ["Banner text (`--ink`)", (L) => r(head[L].p1.banner)],
  ["NOT USED label text (`--ink`)", (L) => r(head[L].p1.notUsedText)],
  ["NOT USED label border (`--c-warning`, non-text 3:1)", (L) => r(head[L].p1.notUsedBorder)],
  ["Duplicate flag, fixture A-601 (HEAD)", (L) => r(head[L].dup.duplicate)],
  ["Duplicate flag, demo (HEAD)", (L) => r(head[L].demo.duplicate)],
  ["Duplicate flag, demo (base 60c82e34)", (L) => r(base[L]?.demo.duplicate)],
  ["From description (`--c-warning`) (HEAD)", (L) => r(head[L].p1.fromDescription)],
  ["From description, demo (base)", (L) => r(base[L]?.demo.fromDescription)],
  ["Row description text, A-601 (HEAD)", (L) => r(head[L].p1.rowDescription)],
  ["Row description text, demo (HEAD)", (L) => r(head[L].demo.rowDescription)],
  ["Row description text, demo (base)", (L) => r(base[L]?.demo.rowDescription)],
];
console.log(`| Element | ${looks.join(" | ")} |`);
console.log(`|---|${looks.map(() => "---").join("|")}|`);
console.log(`| Dialog background | ${looks.map((L) => head[L].p1.banner.bg).join(" | ")} |`);
for (const [name, f] of rows) console.log(`| ${name} | ${looks.map(f).join(" | ")} |`);
console.log("\nrendered colours (HEAD, A-601 / duplicate scene):");
for (const L of looks) console.log(L, JSON.stringify({ banner: head[L].p1.banner.rendered, nuBorder: head[L].p1.notUsedBorder.rendered, dup: head[L].dup.duplicate.rendered + " op " + head[L].dup.duplicate.opacity, desc: head[L].p1.rowDescription.rendered }));
