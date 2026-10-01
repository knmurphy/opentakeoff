// Shared by bench:regions and the calibration sweep: detector output for one
// sheet → the scorer's `Detected`, and label loading filtered by key.
import { readFileSync } from "fs";
import { join } from "path";
import { sheetKeyFor } from "./regionSheets.ts";
import type { DetectDiag, DetectSheet, Edge } from "../src/lib/regionDetect.ts";
import type { SheetRegions } from "../src/lib/regions.ts";
import { labelSpread, passTolerance, type Detected, type LabelEntry } from "./regionScore.ts";

export function toDetected(set: string, s: DetectSheet, rg: SheetRegions, dg: DetectDiag, labelEdge: Edge | null): Detected {
  const tb = rg.regions.find((r) => r.kind === "title_block");
  const edgeForDim = labelEdge ?? dg.edge ?? "bottom";
  const box = dg.border ?? [0, 0, s.w, s.h];
  return {
    key: s.key, set, edge: dg.edge, d: dg.d,
    rules: (tb?.evidence ?? []).filter((e) => e.startsWith("rule:")).map((e) => e.slice(5)),
    confidence: tb?.confidence ?? rg.regions[0]?.confidence ?? 0,
    frameless: !!tb && !tb.evidence.includes("frame-line"),
    group: rg.group ?? null,
    dimPx: edgeForDim === "top" || edgeForDim === "bottom" ? box[3] - box[1] : box[2] - box[0],
  };
}

/** One labeler file's entries whose key is in `allowed`; every other entry
 * (held-out sheets included) is dropped by key before anything reads it. */
export function loadLabels(path: string, allowed: ReadonlySet<string>): Map<string, LabelEntry> {
  const raw = JSON.parse(readFileSync(path, "utf8"));
  const out = new Map<string, LabelEntry>();
  for (const e of raw.sheets as Array<{ key: string }>) if (allowed.has(e.key)) out.set(e.key, e as unknown as LabelEntry);
  return out;
}

/** The answer keys for the allowed sheets: labelers A and B and the
 * reconciled key (evals/regions/labels/reconciled.json, written by
 * bench/regionsReconcile.mts). */
export function loadAnswerKeys(repo: string, allowed: ReadonlySet<string>) {
  const dir = `${repo}/evals/regions/labels`;
  const A = loadLabels(`${dir}/labeler-A.json`, allowed), B = loadLabels(`${dir}/labeler-B.json`, allowed);
  const R = loadLabels(`${dir}/reconciled.json`, allowed) as Map<string, LabelEntry & { resolved_by?: string }>;
  return { A, B, R };
}

/** The pass-bar tolerance (plan, "Metrics", literal reading): max(2 ×
 * max(inter-agent spread, agent-vs-maintainer spread), 0.5%), the
 * inter-agent spread being the MAX per-sheet |dA − dB| over the tune +
 * in-sample sheets after reconciliation (sheets resolved in reconciled.json
 * are left out). Maintainer spread: not available. p90 is information only. */
export function toleranceFor(keys: ReadonlySet<string>, keysets: ReturnType<typeof loadAnswerKeys>) {
  const pick = (m: Map<string, LabelEntry>) => [...m.values()].filter((e) => keys.has(e.key));
  const resolved = new Set([...keysets.R.values()].filter((e) => keys.has(e.key) && e.resolved_by).map((e) => e.key));
  const spread = labelSpread(pick(keysets.A), pick(keysets.B), resolved);
  return { spread, resolved: [...resolved], tol: passTolerance(spread.max ?? 0, null) };
}

export interface BenchSet { name: string; path: string; file: string; pages: number; role: "tune" | "in-sample" | "held-out"; sha256?: string }
/** Committed single sheets: each its own set, in-sample. */
export const COMMITTED_SHEETS: ReadonlyArray<[string, number]> = [
  ["evals/four-asks-2026-09-02/sheets/va-dublin-bldg9a-finish-plan-A601.pdf", 1],
  ["evals/four-asks-2026-09-02/sheets/va-shreveport-fisher-house-site-utility-C300.pdf", 1],
  ["web/public/demo/sample-finish-plan.pdf", 2],
  ["evals/mcp-workflow-bench/plan-set/porterville/porterville-adu-a1-101.pdf", 1],
  ["evals/mcp-workflow-bench/plan-set/roseburg/va-roseburg-a03a.pdf", 1],
];
/** Every bench set: the fetched ones (evals/regions/fetch.mjs SETS, with role and sha256) and the committed sheets. */
export async function benchSets(repo: string): Promise<BenchSet[]> {
  const { SETS } = await import(join(repo, "evals/regions/fetch.mjs"));
  const pdfDir = join(repo, "evals/regions/pdfs");
  const fetched: BenchSet[] = (SETS as Array<{ file: string; pages: number; role: BenchSet["role"]; sha256: string }>)
    .map((s) => ({ name: s.file, path: join(pdfDir, s.file), file: s.file, pages: s.pages, role: s.role, sha256: s.sha256 }));
  const committed: BenchSet[] = COMMITTED_SHEETS.map(([p, n]) => {
    const file = p.replace(/^.*\//, "");
    return { name: file, path: join(repo, p), file, pages: n, role: "in-sample" };
  });
  return [...fetched, ...committed];
}
export const keysOf = (sets: readonly BenchSet[]): Set<string> =>
  new Set(sets.flatMap((s) => Array.from({ length: s.pages }, (_, i) => sheetKeyFor(s.file, i + 1))));
