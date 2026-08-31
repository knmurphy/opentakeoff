// Reading-order text assembly — the parsing half of the Copy-text marquee
// (#copy-text). PURE and pdfjs/DOM-free (the scheduleParse.ts precedent):
// tokens are the shared {str,x,y,h} shape BOTH text sources produce —
//   • vector plans: the page text layer (sheets.extractRegionText)
//   • scanned plans: OCR words (lib/ocr wordsToTokens)
// so one assembly serves both and the copy path never learns which engine
// read the sheet. scheduleParse clusters the same tokens into TABLE rows
// (header hunt, column bands); this clusters them into PROSE lines — no
// headers, no columns, just reading order: lines top→bottom, tokens
// left→right, one space between, one newline per line.
import type { Token } from "./scheduleParse";

/** Baseline tilt (degrees) beyond which a token is excluded from the copy.
 * Plans set prose horizontal but run dimension strings and table headers at
 * 90°; read into a paragraph they garble whatever line they land in, so they
 * are skipped and counted (the caller can say so), never silently mangled.
 * 12° tolerates a scan's slight skew — deskew stays deliberately out of scope
 * (the OCR harness measured engines surviving a degree or two on their own). */
export const MAX_TILT_DEG = 12;

/** y-distance between baselines that still means "same visual line", as a
 * fraction of text height. Same value as scheduleParse's clusterRows so the
 * two clusterers share one notion of a row; scaled by the LARGER of the two
 * heights so a small token beside a tall one (a note under a header, a
 * fraction in a dimension) joins the line it visually belongs to. */
const LINE_TOL = 0.6;

/** tilt of a baseline angle in degrees, normalized to [0,180): 0 and ~180 are
 * horizontal (the latter upside-down), 90 is vertical. ang is absent on OCR
 * words — tesseract already grouped those into lines, so 0 is honest. */
const tiltOf = (ang: number | undefined): number => {
  if (ang == null) return 0;
  const a = ((ang % 180) + 180) % 180;
  return Math.min(a, 180 - a);
};

export interface TextLine {
  /** the line's tokens joined left→right with single spaces */
  text: string;
  /** baseline y of the line (image px, y down) — first token's, stable for sorting */
  y: number;
  tokens: Token[];
}

export interface AssembleResult {
  /** visual lines in reading order (top→bottom) */
  lines: TextLine[];
  /** tokens inside the region but excluded for tilt, with their angles */
  skipped: { token: Token; ang: number }[];
}

/**
 * Assemble positioned tokens (already cropped to the marquee region) into
 * prose lines in reading order. Pure: same tokens in, same lines out.
 */
export function assembleLines(tokens: Token[], opts?: { maxTiltDeg?: number }): AssembleResult {
  const maxTilt = opts?.maxTiltDeg ?? MAX_TILT_DEG;
  const kept: Token[] = [];
  const skipped: { token: Token; ang: number }[] = [];
  for (const t of tokens) {
    const ang = ((t.ang ?? 0) % 180 + 180) % 180;
    if (tiltOf(t.ang) > maxTilt) skipped.push({ token: t, ang });
    else kept.push(t);
  }
  // y-major, x-minor: clustering walks baselines top→bottom and each line's
  // tokens come out already left-ordered
  kept.sort((a, b) => a.y - b.y || a.x - b.x);

  const rows: { sum: number; n: number; maxH: number; toks: Token[] }[] = [];
  for (const t of kept) {
    const row = rows[rows.length - 1];
    // running-average baseline (scheduleParse clusterRows' rule): a tall cell
    // doesn't drag the average, and tol scales with the taller of the pair
    const avg = row ? row.sum / row.n : 0;
    const tol = LINE_TOL * Math.max(row?.maxH ?? t.h, t.h);
    if (row && Math.abs(t.y - avg) <= tol) {
      row.sum += t.y; row.n += 1; row.maxH = Math.max(row.maxH, t.h); row.toks.push(t);
    } else {
      rows.push({ sum: t.y, n: 1, maxH: t.h, toks: [t] });
    }
  }

  const lines: TextLine[] = rows.map((r) => {
    const toks = [...r.toks].sort((a, b) => a.x - b.x);
    return { text: toks.map((t) => t.str).join(" "), y: toks[0].y, tokens: toks };
  });
  return { lines, skipped };
}

/** Lines → clipboard text: one line per visual row, newline-separated. */
export const linesToText = (lines: TextLine[]): string => lines.map((l) => l.text).join("\n");
