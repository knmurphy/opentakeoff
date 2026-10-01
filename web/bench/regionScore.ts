// Scoring helpers for the region bench (bench/regions.mts), pure so the math
// is unit-tested (test/regionScore.test.ts). Metrics as listed in
// docs/design/REGION_ANNOTATION_PLAN.md, "Metrics".
import type { Edge } from "../src/lib/regionDetect.ts";

/** One labeler's answer for one sheet (evals/regions/labels/README.md):
 * normalized page coordinates, displayed orientation; `d` is the strip depth
 * as a fraction of the border box across the edge; null = no title block. */
export interface LabelEntry {
  key: string;
  border: [number, number, number, number];
  title_block: { edge: Edge; inner: number; d: number } | null;
  family: string;
}
/** The mean of two labelers; `disagree` when their edges differ (or one says
 * none): such a sheet has no mean label and is not scored against it. */
export interface MeanLabel extends LabelEntry { disagree: boolean }

/** What the detector said about one sheet. `d` is a fraction of the
 * detector's own border box; `dimPx` is the border box's size across the
 * labeled edge in image px (for the tolerance in px). */
export interface Detected {
  key: string; set: string;
  edge: Edge | null; d: number | null;
  rules: string[]; confidence: number; frameless: boolean;
  group: string | null; dimPx: number;
}

export const TOL_FLOOR = 0.005;
/** Frameless strips (plan amendment 3): edge correct and |d error| ≤ this × d. */
export const FRAMELESS_REL_TOL = 0.25;

export function median(xs: readonly number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b), m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** Nearest-rank quantile: the value at rank ⌈q·n⌉ (1-based). */
export function quantileNearestRank(xs: readonly number[], q: number): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length, Math.max(1, Math.ceil(q * s.length - 1e-9))) - 1];
}

export interface Spread { n: number; edgeDisagree: number; median: number | null; p90: number | null; max: number | null }
/** Inter-labeler spread of d over the keys both files label: per sheet
 * |dA − dB| (0 when both say none); a sheet whose edges differ (or one says
 * none) is counted in `edgeDisagree` and not measured. */
export function labelSpread(a: readonly LabelEntry[], b: readonly LabelEntry[]): Spread {
  const bm = new Map(b.map((e) => [e.key, e]));
  const diffs: number[] = [];
  let edgeDisagree = 0;
  for (const ea of a) {
    const eb = bm.get(ea.key);
    if (!eb) continue;
    const ta = ea.title_block, tb = eb.title_block;
    if (!ta && !tb) diffs.push(0);
    else if (!ta || !tb || ta.edge !== tb.edge) edgeDisagree++;
    else diffs.push(Math.abs(ta.d - tb.d));
  }
  const max = diffs.length ? Math.max(...diffs) : null;
  return { n: diffs.length, edgeDisagree, median: median(diffs), p90: quantileNearestRank(diffs, 0.9), max };
}

/** Pass-bar tolerance: max(2 × max(inter-agent, agent-vs-maintainer), 0.5%);
 * a null maintainer spread ("not available") counts as 0. */
export const passTolerance = (interAgent: number, maintainer: number | null): number =>
  Math.max(2 * Math.max(interAgent, maintainer ?? 0), TOL_FLOOR);

/** P(X ≤ x) for X ~ Binomial(n, p). */
function binomCdf(x: number, n: number, p: number): number {
  let term = Math.pow(1 - p, n), sum = 0;
  for (let k = 0; k <= x; k++) {
    sum += term;
    term *= ((n - k) / (k + 1)) * (p / (1 - p));
  }
  return sum;
}

/** Exact one-sided 95% upper confidence bound on a proportion after x
 * successes in n trials (Clopper-Pearson): the p with P(X ≤ x; n, p) = 0.05.
 * For x = 0 that is 1 − 0.05^(1/n). Null for n = 0. */
export function binomUpper95(x: number, n: number): number | null {
  if (n <= 0) return null;
  if (x >= n) return 1;
  let lo = 0, hi = 1;
  for (let i = 0; i < 100; i++) {
    const mid = (lo + hi) / 2;
    if (binomCdf(x, n, mid) > 0.05) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
}

export function meanLabel(a: LabelEntry, b: LabelEntry): MeanLabel {
  const border = a.border.map((v, i) => (v + b.border[i]) / 2) as LabelEntry["border"];
  const family = a.family === b.family ? a.family : `${a.family}|${b.family}`;
  const ta = a.title_block, tb = b.title_block;
  if (!ta && !tb) return { key: a.key, border, title_block: null, family, disagree: false };
  if (!ta || !tb || ta.edge !== tb.edge) return { key: a.key, border, title_block: null, family, disagree: true };
  return { key: a.key, border, title_block: { edge: ta.edge, inner: (ta.inner + tb.inner) / 2, d: (ta.d + tb.d) / 2 }, family, disagree: false };
}

export interface ScoreRow {
  key: string; set: string;
  negative: boolean; edgeOk: boolean; abstain: boolean; dErr: number | null; pass: boolean;
  falsePositive: boolean; frameless: boolean; framelessPass: boolean; tier: string;
  detEdge: Edge | null; detD: number | null; labelEdge: Edge | null; labelD: number | null; tolPx: number | null;
}

export function scoreSheet(det: Detected, label: LabelEntry, tol: number): ScoreRow {
  const tb = label.title_block;
  const base = {
    key: det.key, set: det.set, abstain: det.edge === null, frameless: det.frameless,
    tier: det.edge ? det.rules.join("+") || "none" : "abstain",
    detEdge: det.edge, detD: det.d, labelEdge: tb?.edge ?? null, labelD: tb?.d ?? null,
  };
  if (!tb) {
    const ok = det.edge === null;
    return { ...base, negative: true, edgeOk: ok, dErr: null, pass: ok, falsePositive: !ok, framelessPass: false, tolPx: null };
  }
  const edgeOk = det.edge === tb.edge;
  const dErr = edgeOk && det.d !== null ? Math.abs(det.d - tb.d) : null;
  return {
    ...base, negative: false, edgeOk, dErr,
    pass: dErr !== null && dErr <= tol + 1e-12,
    falsePositive: false,
    framelessPass: det.frameless && dErr !== null && dErr <= FRAMELESS_REL_TOL * tb.d + 1e-12,
    tolPx: tol * det.dimPx,
  };
}

export interface Summary {
  n: number; edgeOk: number; pass: number; abstain: number;
  dErrMedian: number | null; dErrMax: number | null;
  negatives: { n: number; falsePositives: number };
  tiers: Record<string, { n: number; pass: number }>;
  framed: { n: number; pass: number };
  frameless: { n: number; edgeOk: number; pass: number };
}

export function summarize(rows: readonly ScoreRow[]): Summary {
  const errs = rows.flatMap((r) => (r.dErr === null ? [] : [r.dErr]));
  const tiers: Summary["tiers"] = {};
  for (const r of rows) {
    const t = (tiers[r.tier] ??= { n: 0, pass: 0 });
    t.n++; if (r.pass) t.pass++;
  }
  const framed = rows.filter((r) => r.detEdge && !r.frameless), frameless = rows.filter((r) => r.detEdge && r.frameless);
  const neg = rows.filter((r) => r.negative);
  return {
    n: rows.length,
    edgeOk: rows.filter((r) => r.edgeOk).length,
    pass: rows.filter((r) => r.pass).length,
    abstain: rows.filter((r) => r.abstain).length,
    dErrMedian: median(errs), dErrMax: errs.length ? Math.max(...errs) : null,
    negatives: { n: neg.length, falsePositives: neg.filter((r) => r.falsePositive).length },
    tiers,
    framed: { n: framed.length, pass: framed.filter((r) => r.pass).length },
    frameless: { n: frameless.length, edgeOk: frameless.filter((r) => r.edgeOk).length, pass: frameless.filter((r) => r.framelessPass).length },
  };
}

export interface GroupRow { set: string; key: string; family: string; group: string | null }
export interface GroupingCounts {
  families: number;
  familyUnits: number; splitFamilies: number;        // (set, family) with ≥ 2 grouped sheets; split = > 1 id
  crossPairs: number; mergedPairs: number;           // family pairs inside one set; merged = they share an id
  sameFamilySheetPairs: number; splitSheetPairs: number;
  crossSheetPairs: number; mergedSheetPairs: number;  // sheet pairs of different families in one set; merged = same id
  ungrouped: number;
  meaningful: boolean;                               // ≥ 3 label families
}

/** Detector groups vs label families. Ids are per set (each set is one
 * detectSetRegions run), so splits and merges are counted inside a set;
 * sheets without a group (abstained) are counted apart. */
export function groupingCounts(rows: readonly GroupRow[]): GroupingCounts {
  const families = new Set(rows.map((r) => r.family)).size;
  const grouped = rows.filter((r) => r.group !== null);
  const bySet = new Map<string, GroupRow[]>();
  for (const r of grouped) bySet.set(r.set, [...(bySet.get(r.set) ?? []), r]);
  let familyUnits = 0, splitFamilies = 0, crossPairs = 0, mergedPairs = 0, sameFamilySheetPairs = 0, splitSheetPairs = 0;
  let crossSheetPairs = 0, mergedSheetPairs = 0;
  for (const rs of bySet.values()) {
    const byFam = new Map<string, GroupRow[]>();
    for (const r of rs) byFam.set(r.family, [...(byFam.get(r.family) ?? []), r]);
    const fams = [...byFam.entries()];
    for (const [, members] of fams) {
      if (members.length >= 2) {
        familyUnits++;
        if (new Set(members.map((m) => m.group)).size > 1) splitFamilies++;
      }
      for (let i = 0; i < members.length; i++) for (let j = i + 1; j < members.length; j++) {
        sameFamilySheetPairs++;
        if (members[i].group !== members[j].group) splitSheetPairs++;
      }
    }
    for (let i = 0; i < fams.length; i++) for (let j = i + 1; j < fams.length; j++) {
      crossPairs++;
      const ids = new Set(fams[i][1].map((m) => m.group));
      if (fams[j][1].some((m) => ids.has(m.group))) mergedPairs++;
      for (const a of fams[i][1]) for (const b of fams[j][1]) {
        crossSheetPairs++;
        if (a.group === b.group) mergedSheetPairs++;
      }
    }
  }
  return {
    families, familyUnits, splitFamilies, crossPairs, mergedPairs, sameFamilySheetPairs, splitSheetPairs,
    crossSheetPairs, mergedSheetPairs, ungrouped: rows.length - grouped.length, meaningful: families >= 3,
  };
}

export type GitRun = (args: string[]) => { code: number; out: string };
export interface OrderCheck { verified: boolean; labelCommit: string | null; detectorCommit: string | null; reason: string }
export const LABELS_DIR = "evals/regions/labels";
export const DETECTOR_FILE = "web/src/lib/regionDetect.ts";

/** The plan's order check: the last commit touching the labels must be an
 * ancestor of the first commit touching the detector module
 * (`git merge-base --is-ancestor`). Anything git cannot answer (shallow
 * clone, no such commit) is unverified, with the reason. */
export function checkOrder(git: GitRun): OrderCheck {
  const l = git(["log", "-1", "--format=%H", "--", LABELS_DIR]);
  const labelCommit = l.code === 0 ? l.out.trim().split("\n")[0] || null : null;
  const d = git(["log", "--reverse", "--format=%H", "--", DETECTOR_FILE]);
  const detectorCommit = d.code === 0 ? d.out.trim().split("\n")[0] || null : null;
  if (!labelCommit) return { verified: false, labelCommit, detectorCommit, reason: `cannot check: no commit found for ${LABELS_DIR}` };
  if (!detectorCommit) return { verified: false, labelCommit, detectorCommit, reason: `cannot check: no commit found for ${DETECTOR_FILE}` };
  const a = git(["merge-base", "--is-ancestor", labelCommit, detectorCommit]);
  if (a.code === 0) return { verified: true, labelCommit, detectorCommit, reason: `labels ${labelCommit} is an ancestor of ${detectorCommit}` };
  if (a.code === 1) return { verified: false, labelCommit, detectorCommit, reason: `labels ${labelCommit} is not an ancestor of ${detectorCommit}` };
  return { verified: false, labelCommit, detectorCommit, reason: `cannot check: git merge-base exited ${a.code} (shallow clone?)` };
}

export function fmtPass(k: number, n: number, verified: boolean): string {
  if (!verified) return "UNVERIFIED ORDER";
  if (n === 0) return "0/0";
  return `${k}/${n} (${((100 * k) / n).toFixed(1)}%)`;
}
