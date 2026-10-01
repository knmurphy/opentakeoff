// Writes evals/regions/labels/reconciled.json: the answer key the region
// bench scores against (plan, "Labels": disagreements > 1% are resolved, the
// rest averaged). Reads both labeler files in full but prints only counts —
// never a held-out entry.
//   node --import tsx bench/regionsReconcile.mts
import { readFileSync, writeFileSync } from "fs";
import { join, dirname, resolve } from "path";
import { fileURLToPath } from "url";
import { reconcile, RECONCILE_THRESHOLD, type LabelEntry, type Resolution } from "./regionScore.ts";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const dir = join(repo, "evals/regions/labels");
const read = (f: string) => JSON.parse(readFileSync(join(dir, f), "utf8")) as { definition: string; sheets: LabelEntry[] };
const A = read("labeler-A.json"), B = read("labeler-B.json");

// Resolved per the written definition (README, "Definition (v1)": "a side with
// no frame line uses the page edge"): Porterville's right side has no frame
// line; labeler A used the page edge, labeler B a partial box edge.
const RESOLUTIONS: Record<string, Resolution> = {
  "porterville-adu-a1-101.pdf": { take: "A", resolved_by: "written definition; pending maintainer confirmation" },
};

const r = reconcile(A.sheets, B.sheets, RESOLUTIONS);
if (r.unresolved.length) {
  console.error(`reconcile: ${r.unresolved.length} sheet(s) disagree by > ${RECONCILE_THRESHOLD * 100}% with no resolution; nothing written`);
  process.exit(1);
}
writeFileSync(join(dir, "reconciled.json"), JSON.stringify({
  labeler: "reconciled", definition: A.definition,
  method: `mean of labelers A and B per sheet; sheets with |Δd| > ${RECONCILE_THRESHOLD * 100}% or differing edges take the labeler named in resolved_by's resolution`,
  generated_by: "web/bench/regionsReconcile.mts",
  sheets: r.sheets,
}, null, 1) + "\n");
console.log(`reconciled.json: ${r.sheets.length} sheets, ${r.resolved.length} resolved (${r.resolved.filter((k) => k in RESOLUTIONS).join(", ")}), 0 unresolved`);
