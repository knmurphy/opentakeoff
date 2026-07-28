// Callout cross-check — pure core.
//
// Most finish plans print their own areas ("557 SF") beside the finish tags.
// Those numbers are DESIGNER-authored: the one quantity on the sheet that the
// engine did not compute. Clicking One-Click at each callout and comparing is
// therefore a check against truth we didn't write — unlike the pinned corpus
// goldens, which are the engine's own traces reviewed by eye.
//
// It is a REPORT, never a gate. A callout may annotate a finish zone rather
// than a room's floor, may follow a different boundary convention (to the
// wall face, the centerline, or the finish extent), and may cover several
// spaces at once. A disagreement is a question, not a failure — the hard
// gates belong to human-measured cases (bench/from-takeoff.mts), where the
// convention is known because a human applied it deliberately.
//
// Pure and dependency-free on purpose: the measurement is injected, so the
// core is testable without pdfjs, a mask, or a PDF.

export interface TextItem { str: string; x: number; y: number }
export interface AreaCallout { sf: number; x: number; y: number; raw: string }

/** `557 SF`, `1,718 SF`, `250 S.F.`, `40 sf` — the whole item, not a token
 *  inside a sentence. A schedule row reading "CARPET 557 SF" is deliberately
 *  NOT matched: its anchor is in the schedule, not in the room, so clicking
 *  there measures nothing. Fractional areas are accepted; a bare number is
 *  not (it would swallow room tags and title-block numerals). */
const CALLOUT_RE = /^([\d,]+(?:\.\d+)?)\s*(?:SF|S\.F\.|SQ\.?\s*FT\.?)$/i;

export function parseAreaCallouts(items: TextItem[]): AreaCallout[] {
  const out: AreaCallout[] = [];
  for (const it of items) {
    const m = CALLOUT_RE.exec((it.str || "").trim());
    if (!m) continue;
    const sf = Number(m[1].replace(/,/g, ""));
    if (!Number.isFinite(sf) || sf <= 0) continue;
    out.push({ sf, x: it.x, y: it.y, raw: it.str.trim() });
  }
  return out;
}

/** Text within `radius` px of a point, nearest first — the context that says
 *  what a callout is annotating (a room name, a finish tag, a schedule). */
export function nearbyText(items: TextItem[], x: number, y: number, radius: number, limit = 6): string[] {
  return items
    .map((it) => ({ it, d: Math.hypot(it.x - x, it.y - y) }))
    .filter((r) => r.d > 0 && r.d <= radius)
    .sort((a, b) => a.d - b.d)
    .slice(0, limit)
    .map((r) => r.it.str.trim());
}

/** The seed grid, in FEET, swept around a callout's text anchor. The anchor is
 *  the text baseline origin, which on a stroke-text (SHX) plan lands inside
 *  the glyph linework itself — a seed there measures the inside of a digit.
 *  Sweeping and taking the modal region is what a human does implicitly by
 *  clicking in the open part of the room. */
export const SWEEP_FT = [-4, -2, 0, 2, 4];

export function sweepOffsets(pxPerFt: number, sweepFt: number[] = SWEEP_FT): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (const dy of sweepFt) for (const dx of sweepFt) out.push([dx * pxPerFt, dy * pxPerFt]);
  return out;
}

export interface RegionGroup { sf: number; members: number }

/** Cluster areas that agree within `tol` (relative) and return them
 *  most-populous first; ties break toward the larger area, so the result is
 *  deterministic. The most-populous cluster is the modal region: the answer
 *  most seeds around this callout produce. */
export function clusterAreas(areas: number[], tol = 0.05): RegionGroup[] {
  const groups: { rep: number; members: number[] }[] = [];
  for (const a of areas) {
    const g = groups.find((gp) => Math.abs(gp.rep - a) <= tol * Math.max(Math.abs(gp.rep), Math.abs(a), 1));
    if (g) g.members.push(a); else groups.push({ rep: a, members: [a] });
  }
  return groups
    .map((g) => ({ sf: g.members.reduce((x, y) => x + y, 0) / g.members.length, members: g.members.length }))
    .sort((a, b) => (b.members - a.members) || (b.sf - a.sf));
}

export interface CalloutRow {
  raw: string;                 // the callout as drawn
  printed_sf: number;          // what the drawing claims
  engine_sf: number | null;    // the modal region, null if no seed produced one
  err: number | null;          // (engine − printed) / printed
  agreement: number;           // seeds landing in the modal region
  seeds: number;               // seeds swept
  regions: number;             // distinct regions the sweep found (seed sensitivity)
  refused: number;             // seeds the engine refused
  stable: boolean;             // enough seeds agreed to call this a measurement
  context: string[];           // nearby text — what the callout annotates
}

/** A callout's anchor sits in the room, but the seeds around it can land in
 *  stroke-text glyphs, in a casework notch, or through a doorway. When the
 *  modal region carries fewer than this fraction of the seeds, the sweep did
 *  not find one answer — it found several, and the "modal" one is an artifact
 *  of which offsets happened to hit it. Such rows are reported (the seed
 *  sensitivity IS the finding) but never averaged. */
export const MIN_AGREEMENT_FRAC = 0.4;

/** Measure one seed: the caller's flood+trace, in SF. null = refused or
 *  degenerate. */
export type MeasureFn = (x: number, y: number) => number | null;

export function checkCallouts(
  callouts: AreaCallout[],
  measure: MeasureFn,
  offsets: Array<[number, number]>,
  context: (c: AreaCallout) => string[] = () => [],
): CalloutRow[] {
  return callouts.map((c) => {
    const areas: number[] = [];
    let refused = 0;
    for (const [dx, dy] of offsets) {
      const sf = measure(c.x + dx, c.y + dy);
      if (sf == null || !(sf > 0)) { refused++; continue; }
      areas.push(sf);
    }
    const groups = clusterAreas(areas);
    const mode = groups[0] ?? null;
    return {
      raw: c.raw,
      printed_sf: c.sf,
      engine_sf: mode ? mode.sf : null,
      err: mode ? (mode.sf - c.sf) / c.sf : null,
      agreement: mode ? mode.members : 0,
      seeds: offsets.length,
      regions: groups.length,
      refused,
      stable: !!mode && offsets.length > 0 && mode.members / offsets.length >= MIN_AGREEMENT_FRAC,
      context: context(c),
    };
  });
}

export interface CalloutSummary {
  matched: number;             // rows stable enough to average
  unstable: number;            // rows whose sweep found no single answer
  total: number;
  meanAbsErr: number; medianAbsErr: number; meanSignedErr: number;
  minErr: number; maxErr: number;
  uniformSign: boolean;        // every error the same direction
  verdict: string;
}

/** The one inference this harness is entitled to make. A wrong sheet scale is
 *  a single multiplier on every area, so it shows up as errors that all share
 *  a sign AND cluster in magnitude. Mixed signs rule that out and leave the
 *  per-room questions (convention, annotation boundaries, real error), which
 *  only a human can settle. */
export function summarize(rows: CalloutRow[]): CalloutSummary {
  const errs = rows.filter((r) => r.stable).map((r) => r.err).filter((e): e is number => e != null);
  const total = rows.length;
  const unstable = rows.filter((r) => !r.stable).length;
  if (!errs.length) {
    return {
      matched: 0, unstable, total, meanAbsErr: NaN, medianAbsErr: NaN, meanSignedErr: NaN,
      minErr: NaN, maxErr: NaN, uniformSign: false,
      verdict: unstable
        ? "no callout produced a stable region — every sweep was seed-sensitive, which is itself the finding"
        : "no callout produced a measurable region",
    };
  }
  const abs = errs.map(Math.abs).sort((a, b) => a - b);
  const medianAbsErr = abs.length % 2 ? abs[(abs.length - 1) / 2] : (abs[abs.length / 2 - 1] + abs[abs.length / 2]) / 2;
  const meanAbsErr = errs.reduce((a, e) => a + Math.abs(e), 0) / errs.length;
  const meanSignedErr = errs.reduce((a, e) => a + e, 0) / errs.length;
  const minErr = Math.min(...errs), maxErr = Math.max(...errs);
  const uniformSign = errs.every((e) => e > 0) || errs.every((e) => e < 0);
  const spread = maxErr - minErr;
  const verdict = uniformSign && spread <= 0.05
    ? "errors share a sign and cluster within 5 points — consistent with a wrong sheet scale; check the scale before reading these as engine error"
    : uniformSign
      ? "errors share a sign but not a magnitude — a systematic boundary convention (or a systematic engine bias), not a scale error"
      : "errors have mixed signs — NOT a scale error; each row is its own question (finish-zone vs room floor, annotation boundaries, real error)";
  return { matched: errs.length, unstable, total, meanAbsErr, medianAbsErr, meanSignedErr, minErr, maxErr, uniformSign, verdict };
}
