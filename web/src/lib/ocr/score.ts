// Scoring for the schedule-OCR harness (docs/SCHEDULE-OCR.md). Two layers,
// because attribution matters more than a single number:
//   • word level — detection recall/precision (box matching by IoU) and
//     character error rate over the matched pairs: separates "the engine never
//     saw that cell" from "it read SDT-334 as SDT-384";
//   • row level — the product truth: rows matched by finish_tag, then per-field
//     accuracy. finish_tag is the match key on purpose: normalizeScanRows drops
//     untagged rows today, so a misread tag is a VANISHED row, not a typo.
// PURE and dependency-free; the benchmark script and tests share these.
import type { ScheduleRow } from "../scheduleParse";
import { wordBbox, type OcrWord } from "./types";

/** Plain Levenshtein distance (unit costs). Strings here are short cells. */
export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  const m = a.length, n = b.length;
  if (!m) return n;
  if (!n) return m;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  const cur = new Array<number>(n + 1);
  for (let i = 1; i <= m; i++) {
    cur[0] = i;
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(
        prev[j] + 1,
        cur[j - 1] + 1,
        prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    prev = [...cur];
  }
  return prev[n];
}

/** Character error rate of hyp against ref (0 = perfect; can exceed 1). */
export const cer = (ref: string, hyp: string): number =>
  ref.length ? levenshtein(ref, hyp) / ref.length : hyp.length ? 1 : 0;

/** Corpus CER: total edits over total reference length — the aggregate a
 * per-string mean would distort (short strings would dominate). */
export function corpusCer(pairs: [ref: string, hyp: string][]): number {
  let edits = 0, len = 0;
  for (const [ref, hyp] of pairs) { edits += levenshtein(ref, hyp); len += ref.length; }
  return len ? edits / len : 0;
}

const iou = (a: OcrWord, b: OcrWord): number => {
  const [ax0, ay0, ax1, ay1] = wordBbox(a);
  const [bx0, by0, bx1, by1] = wordBbox(b);
  const ix = Math.max(0, Math.min(ax1, bx1) - Math.max(ax0, bx0));
  const iy = Math.max(0, Math.min(ay1, by1) - Math.max(ay0, by0));
  const inter = ix * iy;
  const union = (ax1 - ax0) * (ay1 - ay0) + (bx1 - bx0) * (by1 - by0) - inter;
  return union > 0 ? inter / union : 0;
};

export interface WordMatch { gt: OcrWord; pred: OcrWord; iou: number }
export interface WordMatchResult {
  matches: WordMatch[];
  /** ground-truth words no prediction covered — detection misses */
  missed: OcrWord[];
  /** predictions covering no ground truth — hallucinated boxes */
  spurious: OcrWord[];
  detectionRecall: number;
  detectionPrecision: number;
  /** corpus CER over the matched pairs (text quality of what WAS detected) */
  matchedCer: number;
}

/** Greedy one-to-one box matching, best IoU first, floor `iouMin` (0.5 —
 * the standard detection threshold). */
export function matchWords(gt: OcrWord[], pred: OcrWord[], iouMin = 0.5): WordMatchResult {
  const cand: { gi: number; pi: number; v: number }[] = [];
  for (let gi = 0; gi < gt.length; gi++) {
    for (let pi = 0; pi < pred.length; pi++) {
      const v = iou(gt[gi], pred[pi]);
      if (v >= iouMin) cand.push({ gi, pi, v });
    }
  }
  cand.sort((a, b) => b.v - a.v);
  const gtUsed = new Set<number>(), predUsed = new Set<number>();
  const matches: WordMatch[] = [];
  for (const c of cand) {
    if (gtUsed.has(c.gi) || predUsed.has(c.pi)) continue;
    gtUsed.add(c.gi); predUsed.add(c.pi);
    matches.push({ gt: gt[c.gi], pred: pred[c.pi], iou: c.v });
  }
  return {
    matches,
    missed: gt.filter((_, i) => !gtUsed.has(i)),
    spurious: pred.filter((_, i) => !predUsed.has(i)),
    detectionRecall: gt.length ? matches.length / gt.length : 1,
    detectionPrecision: pred.length ? matches.length / pred.length : 1,
    matchedCer: corpusCer(matches.map((m) => [m.gt.str, m.pred.str])),
  };
}

/** Field comparison normalization: case, runs of whitespace, edge trim. What's
 * left is what an estimator would call "the same cell". */
export const normField = (s: string): string => (s || "").toUpperCase().replace(/\s+/g, " ").trim();

/** The row fields scored independently. finish_tag is the MATCH KEY, not a
 * scored field; section is unscored because category is its normalized form. */
export const SCORED_FIELDS = ["category", "description", "manufacturer", "style", "spec_color", "size"] as const;
export type ScoredField = (typeof SCORED_FIELDS)[number];

export interface RowScore {
  gtCount: number;
  predCount: number;
  matched: number;
  /** matched / gtCount — a lost row is the worst outcome */
  rowRecall: number;
  /** matched / predCount — invented rows are the second-worst */
  rowPrecision: number;
  /** per-field exact-after-normalization rate over matched rows */
  fieldAcc: Record<ScoredField, number>;
  /** mean of fieldAcc across SCORED_FIELDS */
  fieldAccOverall: number;
  /** corpus CER over the matched rows' text fields (category excluded) */
  fieldCer: number;
  /** matched rows with every scored field exact */
  perfectRows: number;
}

/** Score predicted rows against reference rows. Tags are matched as a multiset
 * (two rows sharing a tag consume two predictions) in reference order. */
export function scoreRows(gt: ScheduleRow[], pred: ScheduleRow[]): RowScore {
  const pool = new Map<string, ScheduleRow[]>();
  for (const p of pred) {
    const k = normField(p.finish_tag);
    pool.set(k, [...(pool.get(k) ?? []), p]);
  }
  const pairs: [ScheduleRow, ScheduleRow][] = [];
  for (const g of gt) {
    const q = pool.get(normField(g.finish_tag));
    const p = q?.shift();
    if (p) pairs.push([g, p]);
  }
  const fieldAcc = {} as Record<ScoredField, number>;
  const cerPairs: [string, string][] = [];
  let perfectRows = 0;
  for (const f of SCORED_FIELDS) fieldAcc[f] = 0;
  for (const [g, p] of pairs) {
    let perfect = true;
    for (const f of SCORED_FIELDS) {
      const ok = f === "category" ? g.category === p.category : normField(g[f]) === normField(p[f]);
      if (ok) fieldAcc[f]++;
      else perfect = false;
      if (f !== "category") cerPairs.push([normField(g[f]), normField(p[f])]);
    }
    if (perfect) perfectRows++;
  }
  const n = pairs.length;
  for (const f of SCORED_FIELDS) fieldAcc[f] = n ? fieldAcc[f] / n : 1;
  const vals = SCORED_FIELDS.map((f) => fieldAcc[f]);
  return {
    gtCount: gt.length,
    predCount: pred.length,
    matched: n,
    rowRecall: gt.length ? n / gt.length : 1,
    rowPrecision: pred.length ? n / pred.length : 1,
    fieldAcc,
    fieldAccOverall: vals.reduce((a, b) => a + b, 0) / vals.length,
    fieldCer: corpusCer(cerPairs),
    perfectRows,
  };
}
