// Shared by bench:regions and the calibration sweep: detector output for one
// sheet → the scorer's `Detected`, and label loading filtered by key.
import { readFileSync } from "fs";
import type { DetectDiag, DetectSheet, Edge } from "../src/lib/regionDetect.ts";
import type { SheetRegions } from "../src/lib/regions.ts";
import type { Detected, LabelEntry } from "./regionScore.ts";

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
