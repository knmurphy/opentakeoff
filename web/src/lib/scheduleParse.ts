// Finish/material-schedule → conditions importer (the "Import from schedule"
// marquee feature). PURE and pdfjs-free on purpose: it takes already-positioned
// text tokens and returns normalized rows, so the SAME parser serves both paths —
//   • vector plans: tokens come from the page text layer (sheets.extractRegionText)
//   • scanned plans: tokens come from a server OCR/VLM adapter that returns the
//     same {str,x,y,h} shape (or ScheduleRow[] directly).
// The dialog approves rows; rowToSeed() maps an approved row to a condition seed
// the canvas instantiates. Kept here (not in the canvas) so the column math is
// testable — the sheets.ts / oneclick.ts precedent.

export type Token = { str: string; x: number; y: number; h: number };

export type Category = "floor" | "base" | "wall" | "transition" | "ceiling" | "other";

export type ScheduleRow = {
  finish_tag: string;        // CODE cell, e.g. "CPT-1"
  section: string;           // raw section header it fell under, e.g. "FLOORING"
  category: Category;        // section → category; drives default color + the checkbox
  description: string;       // MATERIAL/PRODUCT cell
  manufacturer: string;      // MANUFACTURER cell
  style: string;             // STYLE cell
  spec_color: string;        // COLOR cell (the spec'd color, e.g. "1408 RIVERSTONE")
  size: string;              // SIZE cell
  suggested: boolean;        // default-checked in the dialog (ceiling/other start off)
};

// Section header text → category. A flooring tool cares about floor/base/wall
// (+ transitions); ceilings and millwork are parsed but start UNCHECKED so the
// estimator never has to hunt them down — they can still opt one in per-row.
const SECTION_CATEGORY: Record<string, Category> = {
  FLOORING: "floor", FLOOR: "floor",
  BASE: "base", BASES: "base",
  WALLS: "wall", WALL: "wall",
  MISC: "transition", TRANSITIONS: "transition", TRANSITION: "transition", TRIM: "transition",
  MILLWORK: "other",
  CEILINGS: "ceiling", CEILING: "ceiling",
};
const SUGGESTED: Record<Category, boolean> = {
  floor: true, base: true, wall: true, transition: true, ceiling: false, other: false,
};

// The seven schedule columns, in order. We anchor bands off whichever header
// tokens we find (empty cells emit no token, so anchoring to the header — not to
// the nearest data word — is what keeps blank cells from stealing a neighbour).
const COLUMNS = ["CODE", "MATERIAL", "MANUFACTURER", "STYLE", "COLOR", "SIZE", "REMARKS"] as const;
type Column = (typeof COLUMNS)[number];

// A finish code: 1–4 caps, optional "-" + alphanumerics (CPT-1, PT-2, RB-1,
// ACT-1, PLAM-2, RES-W), or a lone letter (C = concrete sealer). Section words
// are caps too, so the caller checks those first.
const CODE_RE = /^[A-Z]{1,4}(-[A-Z0-9]{1,4})?$/;
// OCR-tolerant code shape (issue: browser-OCR noise budget). When the strict
// form fails, accept 1–5 alnum + optional "-" + 1–5 alnum PROVIDED there is at
// least one letter — so a glyph confusion in the alpha prefix (CPT-1 → CP7-1)
// still reads as a code, while a lone number (a keynote, a dim, a stray color
// index like 51839) never does. Only reached when the strict form misses, so
// clean vector text is byte-for-byte unaffected.
const CODE_RE_FUZZY = /^[A-Z0-9]{1,5}(-[A-Z0-9]{1,5})?$/;
const looksLikeCode = (s: string): boolean => CODE_RE.test(s) || (CODE_RE_FUZZY.test(s) && /[A-Z]/.test(s));

const norm = (s: string) => (s || "").trim().toUpperCase();
const sectionKey = (s: string) => norm(s).replace(/[^A-Z]/g, "");

// Bounded edit distance: is `a` within `k` edits of `b`? Early-exits when a
// whole DP row exceeds k, so it stays cheap for the k∈{1,2} the fuzzy fallbacks
// use. The harness (lib/ocr/score.ts) has a full levenshtein for measurement;
// this bounded twin keeps scheduleParse self-contained and pdfjs-free.
function withinEdits(a: string, b: string, k: number): boolean {
  const m = a.length, n = b.length;
  if (Math.abs(m - n) > k) return false;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    let rowMin = i;
    for (let j = 1; j <= n; j++) {
      const v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      cur.push(v);
      if (v < rowMin) rowMin = v;
    }
    if (rowMin > k) return false;
    prev = cur;
  }
  return prev[n] <= k;
}

// A header word matches its column name when it starts with the 5-char prefix
// (the strict rule) OR the same length of prefix is within 1 edit (a confusion
// like MANUF→MANDF, or COLOR→C0LOR). Comparing only the prefix keeps a wrapped
// two-word header ("MATERIAL/PRODUCT") matching MATERIAL.
const headerHit = (u: string, col: Column): boolean => {
  const p = col.slice(0, 5);
  return u.startsWith(p) || withinEdits(u.slice(0, p.length), p, 1);
};
const fuzzyIncludes = (ups: string[], target: string, k: number): boolean =>
  ups.includes(target) || ups.some((u) => withinEdits(u, target, k));

// The section vocabulary as a list, for prefix/fuzzy resolution when the exact
// stripped key misses. Order is longest-first so a longer word wins a prefix
// tie (MISCFINISHES → MISC before any 4-letter near-miss).
const SECTION_WORDS = Object.keys(SECTION_CATEGORY).sort((a, b) => b.length - a.length);

// Resolve a stripped section key to its category, OCR-tolerantly. Exact wins;
// then a prefix relationship of ≥4 shared leading chars (this is what catches
// "MISC. FINISHES" → MISCFINISHES → MISC, a real-layout miss the strict map has
// always had); then within 1 edit (2 for the longer words). Returns null when
// nothing plausibly matches, so a data row is never mistaken for a section.
function sectionCategory(key: string): Category | null {
  if (SECTION_CATEGORY[key]) return SECTION_CATEGORY[key];
  for (const w of SECTION_WORDS) {
    if (w.length >= 4 && key.length >= 4 && (key.startsWith(w) || w.startsWith(key))) return SECTION_CATEGORY[w];
  }
  for (const w of SECTION_WORDS) {
    if (withinEdits(key, w, w.length >= 7 ? 2 : 1)) return SECTION_CATEGORY[w];
  }
  return null;
}

// Conservative finish-code prefix → category, consulted ONLY when no section
// header is active (docs/SCHEDULE-CELL-PARSING-SPEC.md): an OCR engine drops the
// isolated section words unpredictably, so a rescued row still gets a sensible
// category. ONLY unambiguous flooring-trade prefixes are listed — a prefix that
// spans categories in real schedules (PT porcelain floor-or-wall, CT ceramic
// wall-or-base, P paint) is deliberately ABSENT so it falls back to "other"
// instead of guessing wrong. Never overrides a detected section (see parseSchedule).
// Kept deliberately SMALL and defensible — every prefix here is an unambiguous
// flooring-trade convention (carpet/vinyl/resilient → floor; resilient/carpet
// base → base; acoustic ceiling → ceiling). Prefixes that span categories in
// real schedules are omitted (PT/CT/P) as are weaker two-letter guesses
// (WB/VB/SB). Inference is a best-effort gap-filler, never authoritative.
const CODE_PREFIX_CATEGORY: Record<string, Category> = {
  CPT: "floor", VCT: "floor", LVT: "floor", LVP: "floor", RF: "floor", WSF: "floor", RES: "floor",
  RB: "base", CBT: "base",
  ACT: "ceiling", ACP: "ceiling",
};
// The alpha prefix of a finish code: the leading A–Z run before any digit/dash.
const prefixCategory = (code: string): Category | null =>
  CODE_PREFIX_CATEGORY[/^[A-Z]+/.exec(code)?.[0] ?? ""] ?? null;

// A clustered row that is a column-HEADER (not data): the header signature is
// CODE + a MANUFACTURER/COLOR anchor. Used to skip the header AND any repeated
// header (a second stacked table's header row) so neither leaks a "CODE" row.
function isHeaderRow(r: Token[]): boolean {
  const ups = r.map((t) => norm(t.str).replace(/[^A-Z]/g, ""));
  return fuzzyIncludes(ups, "CODE", 1) && (fuzzyIncludes(ups, "MANUFACTURER", 2) || fuzzyIncludes(ups, "COLOR", 1));
}

// A clustered row that is a SECTION label, else null. A section label is a BARE
// discipline word (no dash/digit): "BASE-1" is a finish code, NOT the BASE
// section — without this guard the fuzzy resolver eats the code AND its whole
// data row, then mis-categorizes every row beneath it (adversarial review M4).
function asSectionRow(r: Token[]): { key: string; cat: Category } | null {
  const first = r[0];
  // A finish code carries a dash-suffix ("BASE-1", "FLOOR-2"); a section label
  // does not. Keying on the dash (not on digits) still lets a digit-CONFUSED
  // section word through — "FL0ORING" has no dash and resolves to FLOORING.
  if (first.str.includes("-")) return null;
  const joined = r.map((t) => t.str).join(" ").trim();
  if (joined.length >= 24) return null;
  const key = sectionKey(first.str);
  const cat = sectionCategory(key);
  return cat ? { key, cat } : null;
}

// Cluster tokens into visual rows by y, then order each row left→right. A row's
// y is the running average so a tall cell doesn't split. tolFrac scales the gap
// test to the text height so it works at any raster/zoom.
function clusterRows(tokens: Token[]): Token[][] {
  const toks = [...tokens].filter((t) => t.str && t.str.trim()).sort((a, b) => a.y - b.y || a.x - b.x);
  const rows: Token[][] = [];
  let cur: Token[] = [];
  let cy = 0;
  for (const t of toks) {
    const tol = Math.max(t.h * 0.6, 4);
    if (cur.length && Math.abs(t.y - cy) > tol) { rows.push(cur); cur = []; }
    cur.push(t);
    cy = cur.reduce((s, w) => s + w.y, 0) / cur.length;
  }
  if (cur.length) rows.push(cur);
  return rows.map((r) => r.sort((a, b) => a.x - b.x));
}

const cx = (t: Token) => t.x + 0; // x is the left edge; header cells left-align, so left edge anchors best
const rowCy = (r: Token[]) => r.reduce((s, t) => s + t.y, 0) / r.length;

// Blank-band section reset (docs/SCHEDULE-SECTION-RESET-SPEC.md): a mid-table
// section header an OCR engine DROPS still leaves a vertical band — a gap larger
// than the table's typical data-row gap. Keyed on the MEDIAN-RELATIVE gap, never
// an absolute k·h: the vector text layer (cap-height) and an OCR engine (full
// glyph extent) scale token height differently, so an absolute multiple that
// fires on an OCR band also fires on every vector row. Below the header a vector
// table's gaps are ≤1.36× its median; an OCR band is ≥2.7×. K=1.6 sits in the
// valley (n=1 demo sheet — the mechanism is layout-agnostic, the constant is not
// yet corpus-validated: step 5b).
const BAND_GAP_K = 1.6;
const MIN_GAP_SAMPLES = 4; // too few rows → the median is noise → reset disabled

// Median gap between consecutive clustered rows from `from` onward, or null when
// there are too few gaps to trust the median (a tiny table keeps step-4 behavior).
function medianRowGap(rows: Token[][], from: number): number | null {
  const gaps: number[] = [];
  for (let i = from + 1; i < rows.length; i++) gaps.push(rowCy(rows[i]) - rowCy(rows[i - 1]));
  if (gaps.length < MIN_GAP_SAMPLES) return null;
  const sorted = [...gaps].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

// Find the header row and return its column anchors (x of each found header
// token, sorted) plus its INDEX in `rows` (so the caller processes only rows
// below it — the header's own first cell "CODE" is code-shaped and must never
// be read as data). Requires CODE plus one of MANUFACTURER/COLOR so we don't
// mistake a data row for the header.
interface HeaderMatch { anchors: { col: Column; x: number }[]; headerIdx: number }
function findAnchors(rows: Token[][]): HeaderMatch | null {
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const ups = r.map((t) => norm(t.str).replace(/[^A-Z]/g, ""));
    // Header words tolerate noise: CODE within 1 edit, MANUFACTURER within 2
    // (it's long), COLOR within 1 — so a single glyph confusion in a header
    // cell no longer drops the whole schedule (the parser's sharpest cliff).
    const hasCode = fuzzyIncludes(ups, "CODE", 1);
    const hasAnchor = fuzzyIncludes(ups, "MANUFACTURER", 2) || fuzzyIncludes(ups, "COLOR", 1);
    if (!hasCode || !hasAnchor) continue;
    const anchors: { col: Column; x: number }[] = [];
    for (const t of r) {
      const u = norm(t.str).replace(/[^A-Z]/g, "");
      for (const c of COLUMNS) if (headerHit(u, c)) { anchors.push({ col: c, x: cx(t) }); break; }
    }
    // de-dupe (a wrapped header can repeat) keeping the leftmost, need ≥3 to band
    const seen = new Set<string>();
    const uniq = anchors.filter((a) => (seen.has(a.col) ? false : (seen.add(a.col), true))).sort((a, b) => a.x - b.x);
    if (uniq.length >= 3) return { anchors: uniq, headerIdx: i };
  }
  return null;
}

// Which column a token's x falls in: nearest-anchor with fixed midpoint bounds.
function columnFor(x: number, anchors: { col: Column; x: number }[]): Column {
  let best = anchors[0];
  for (const a of anchors) if (Math.abs(a.x - x) < Math.abs(best.x - x)) best = a;
  return best.col;
}

/**
 * Parse positioned tokens (already cropped to the marquee region) into rows.
 * Returns [] when no header/section structure is found — the caller shows
 * "no schedule detected here" rather than inventing rows.
 */
export function parseSchedule(tokens: Token[]): ScheduleRow[] {
  const rows = clusterRows(tokens);
  const found = findAnchors(rows);
  if (!found) return [];
  const { anchors, headerIdx } = found;

  let section = "";
  let sectionCat: Category | null = null;
  // Seed the section from a discipline label sitting ABOVE the column header
  // (some layouts put "FLOORING" over the header row). Without this the section
  // would be lost when we start reading below the header (adversarial review M3).
  for (let i = 0; i < headerIdx; i++) {
    const s = asSectionRow(rows[i]);
    if (s) { section = s.key; sectionCat = s.cat; }
  }

  // The reset needs the table's typical row pitch; null on a tiny table (keeps
  // step-4 behavior there — the median would be noise).
  const bandGap = medianRowGap(rows, headerIdx);
  let prevCy = rowCy(rows[headerIdx]);

  const out: ScheduleRow[] = [];
  // Only rows BELOW the header are data. The header row itself (first cell
  // "CODE", code-shaped) and any title/page text above it are never rows.
  for (let i = headerIdx + 1; i < rows.length; i++) {
    const r = rows[i];
    const gap = rowCy(r) - prevCy;
    prevCy = rowCy(r);
    // A repeated header (a second stacked table) is a separator, never data —
    // its "CODE" cell is code-shaped and would otherwise leak a row. It also
    // starts a NEW table, so clear the section (table 1's last section must not
    // bleed into table 2's rows).
    if (isHeaderRow(r)) { section = ""; sectionCat = null; continue; }
    // A section label updates the current category and is not itself a row.
    const s = asSectionRow(r);
    if (s) { section = s.key; sectionCat = s.cat; continue; }
    // Blank-band reset: a gap far larger than the median data-row gap is the
    // ghost of a section header the OCR engine dropped. Clear the stale section
    // so this row takes an inferred (or "other") category instead of latching
    // the section above the band — a base row must not bid as the floor above it
    // (docs/SCHEDULE-SECTION-RESET-SPEC.md). Never fires on the vector path,
    // where below-header gaps stay ≤1.36× the median.
    if (bandGap !== null && gap > BAND_GAP_K * bandGap) { section = ""; sectionCat = null; }
    // A code-shaped first cell IS a row — NOT gated on a preceding section
    // header, which an OCR engine drops unpredictably and would take every row
    // beneath it down with it (docs/SCHEDULE-CELL-PARSING-SPEC.md). Fuzzy code
    // shape so a confused glyph (CPT-1 → CP7-1) doesn't silently drop the row.
    const first = r[0];
    const codeTok = norm(first.str).replace(/[^A-Z0-9-]/g, "");
    if (!looksLikeCode(codeTok)) continue;

    const cells: Record<Column, string[]> = { CODE: [], MATERIAL: [], MANUFACTURER: [], STYLE: [], COLOR: [], SIZE: [], REMARKS: [] };
    for (const t of r) cells[columnFor(cx(t), anchors)].push(t.str.trim());
    // Junk guard (the section gate used to suppress this, and it's gone): a real
    // data row fills the CODE column PLUS at least one other. A lone token — a
    // revision bubble "A", a stray "GC" note — fills only one column and is not
    // a row. Keeps the spec's "nothing is invented" invariant (review M1).
    const filled = (Object.keys(cells) as Column[]).filter((c) => cells[c].length).length;
    if (filled < 2) continue;
    // A detected section is authoritative; with none active, infer category
    // from the code prefix (conservative, unambiguous only); else "other".
    // Inference NEVER overrides a section — the vector path always has sections
    // in order, so this branch only fires on OCR-missed-section rows.
    const category = sectionCat ?? prefixCategory(codeTok) ?? "other";
    out.push({
      finish_tag: codeTok,
      section,
      category,
      description: cells.MATERIAL.join(" ").trim(),
      manufacturer: cells.MANUFACTURER.join(" ").trim(),
      style: cells.STYLE.join(" ").trim(),
      spec_color: cells.COLOR.join(" ").trim(),
      size: cells.SIZE.join(" ").trim(),
      suggested: SUGGESTED[category],
    });
  }
  return out;
}

// Default line/fill palette when the canvas doesn't pass its own — mirrors the
// canvas PALETTE order loosely; the estimator can recolor after.
const FALLBACK_PALETTE = ["#2f7d54", "#2563eb", "#9333ea", "#be185d", "#b8860b", "#0d9488", "#475569", "#c96442"];
// Category → default hatch + waste so an imported floor reads like a floor and a
// base like a base without the estimator touching the appearance editor.
const CAT_HATCH: Record<Category, string> = { floor: "solid", base: "horiz", wall: "grid", transition: "vert", ceiling: "solid", other: "solid" };
const CAT_WASTE: Record<Category, number> = { floor: 5, base: 10, wall: 10, transition: 0, ceiling: 0, other: 0 };

export type ConditionSeed = {
  finish_tag: string;
  color: string;
  hatch: string;
  waste_pct: number;
  materials: never[];
  // product spec, for the canvas to drop into condition attrs / report columns.
  // `description` (the MATERIAL/PRODUCT cell, e.g. "WOOD WALL PANEL") rides along
  // so the most human-readable label survives import instead of being dropped.
  spec: { manufacturer: string; style: string; color: string; size: string; description: string };
  category: Category;
};

/** Map an approved row to a condition seed (no ids — the canvas mints those). */
export function rowToSeed(row: ScheduleRow, index: number, palette: string[] = FALLBACK_PALETTE): ConditionSeed {
  const color = palette[index % palette.length] || FALLBACK_PALETTE[0];
  return {
    finish_tag: row.finish_tag,
    color,
    hatch: CAT_HATCH[row.category],
    waste_pct: CAT_WASTE[row.category],
    materials: [],
    spec: { manufacturer: row.manufacturer, style: row.style, color: row.spec_color, size: row.size, description: row.description },
    category: row.category,
  };
}
