// Import from schedule — the reader. A marquee around a finish/material
// schedule is read by the finish reader the sheet graph indexes with, through
// its marquee entry point (sheetgraph.ts readFinishMarquee), so the canvas and
// the in-canvas agent's read_schedule read one box one way. The marquee entry
// adds rules the whole-sheet index (buildSheetGraph, the MCP's find_schedule
// and resolve_tag) doesn't run — NOT USED rows, codes with a word after them,
// code lines split from the row above, four- and five-letter codes and the
// skipped list (#483) — so a drawn box reads more forms than resolve_tag.
// Import from schedule's raster read (#470) feeds it the on-device reader's
// words as spans, with opts.ocr set (readScheduleSpans); on that read a code
// the reader misread (PT-O1, $SM-1) is repaired here, and the row says what
// was read (read_as, #482), and a "/" it read as "7" in the item's words is
// put back.
// This module turns that table into approval-dialog rows: it refuses tables
// that are another schedule family, names each row's category, and joins the
// cells a row's description is spread over.
//
// The only schedule module that imports the sheet graph: the canvas loads it
// with import() when a marquee is read, and seeds conditions from the light
// scheduleRows.ts.
import { FOREIGN_HDR, extractTables, isNonFinishSchedule, readFinishMarquee, traceFinishMarquee, type Bbox, type GraphSpan, type MarqueeRead, type ScheduleTable, type TableRow } from "./sheetgraph.ts";
import { FINISH_SECTION_CATEGORY, type FinishSection } from "./finishSections.ts";
import { normalizeNotUsed } from "./notUsed.ts";
import { finishCodeOk } from "./finishCode.ts";
import { repairKey } from "./ocr/wordClean.ts";
import { reshapeBox, type AliasReshaped } from "./scheduleReshape.ts";
import type { Category, CategorySource, ScheduleRow, Token } from "./scheduleRows.ts";

/** Why a marquee gave no rows. "no-table": no finish table was read at all
 *  (an empty box, or text that holds no table). Every other reason is a table
 *  that IS there but is not a finish/material schedule — "title": its title
 *  names another family (DOOR SCHEDULE …); "equipment": the sheet graph's
 *  equipment reader reads a device schedule (a GPM, HP, MBH, NECK … column)
 *  on the table's own ink, and nothing on the table says finish;
 *  "foreign-header": a column only another family
 *  prints (QTY, CFM, MESSAGE …); "no-color-style-pattern": nothing about it
 *  says finish (no CODE key, no printed finish heading, no item +
 *  MANUFACTURER columns, and no COLOR / STYLE / PATTERN column). */
export type RefusalReason = "no-table" | "title" | "equipment" | "foreign-header" | "no-color-style-pattern";
/** `skipped`: four- or five-letter codes with no number (EPOX) the reader
 *  saw in the table's key column but did not read as rows, in y order —
 *  present only when there is one. A box whose only codes were skipped reads
 *  `{ rows: [], skipped }`. A refusal never carries it. */
export type ScheduleRead =
  | { rows: ScheduleRow[]; skipped?: string[] }
  | { rows: []; refused: RefusalReason; title?: string };

// ── the header guard ─────────────────────────────────────────────────────────
// FOREIGN_HDR — header words only a non-finish schedule carries — lives in
// sheetgraph.ts (the marquee rules read it too) and is re-exported here.
export { FOREIGN_HDR };
/** The FOREIGN_HDR words that never name a finish attribute (counts, devices,
 *  sign text): an item column + MANUFACTURER does not excuse them. */
const HARD_HDR = new Set(["QTY", "QUANTITY", "MESSAGE", "CFM", "VOLTS", "VOLTAGE", "WATTS", "LAMP", "LAMPS"]);
const ITEM_COL = /^(MATERIAL|DESCRIPTION|PRODUCT)$/;
const LOOK_COL = /^(COLOR|STYLE|PATTERN)$/;

/** The refusal a finish-shaped table earns, or null to read it. `words` are
 *  the header row's raw words as printed; `headers` the canonical columns
 *  (headers[0] the key column). A table says "finish" by a CODE key, a
 *  printed finish heading over any row, or naming both what the item is and
 *  who makes it — and only a table that says nothing of the kind is refused
 *  for a column word another family uses, or for having no COLOR / STYLE /
 *  PATTERN column. A count / device / sign-text column refuses even item +
 *  MANUFACTURER (a furniture schedule has both); a CODE key or a printed
 *  heading still wins. */
export function headerRefusal(headers: string[], words: string[], hasSection: boolean): RefusalReason | null {
  const code = headers[0] === "CODE";
  const named = headers.some((h) => ITEM_COL.test(h)) && headers.includes("MANUFACTURER");
  const finishy = code || hasSection || named;
  const foreign = words.filter((w) => FOREIGN_HDR.has(w));
  if (!code && !hasSection && foreign.some((w) => HARD_HDR.has(w))) return "foreign-header";
  if (foreign.length && !finishy) return "foreign-header";
  if (!finishy && !headers.some((h) => LOOK_COL.test(h))) return "no-color-style-pattern";
  return null;
}

// ── category from the row's own words ────────────────────────────────────────
type WordCategory = "base" | "transition" | "wall_protection";
const plural = (p: string) => [p, p + "S"];
// Item-naming phrases only — never a material or surface word, never a tag
// letter. An exclusion (null) consumes its words so the BASE inside BASE
// CABINET, INTEGRAL COVE BASE or BASE BID names nothing.
const WORD_PHRASES: Array<[string, WordCategory | null]> = [
  ...["BASE CABINET", "BASE COAT", "BASE PLATE", "BASE SHEET"].flatMap(plural).map((p): [string, null] => [p, null]),
  ["BASE BID", null], ["SINK BASE", null], ["VANITY BASE", null],
  ["INTEGRAL COVE BASE", null], ["INTEGRAL COVED BASE", null], ["INTEGRAL BASE", null],
  ["SANITARY COVE BASE", null], ["SANITARY COVED BASE", null], ["SANITARY BASE", null],
  ["FLASH COVE BASE", null], ["FLASH COVED BASE", null],
  ["WALL BASE", "base"], ["COVE BASE", "base"], ["RUBBER BASE", "base"], ["RESILIENT BASE", "base"], ["BASE", "base"],
  ...["TRANSITION", "TRANSITION STRIP", "THRESHOLD", "REDUCER", "STAIR NOSING", "EDGE STRIP"]
    .flatMap(plural).map((p): [string, WordCategory] => [p, "transition"]),
  ["WALL PROTECTION", "wall_protection"],
  ...["HANDRAIL", "CORNER GUARD", "CORNERGUARD", "CRASH RAIL", "PROTECTIVE RAIL", "BUMPER GUARD"]
    .flatMap(plural).map((p): [string, WordCategory] => [p, "wall_protection"]),
];
// A floor surface a base can be an accessory OF: "EPOXY FLOORING W/ 4 IN. COVE
// BASE" describes the floor, it does not name a base item.
const FLOOR_SURFACES = new Set(["FLOORING", "FLOOR", "EPOXY", "RESINOUS", "TERRAZZO", "CARPET", "CONCRETE", "TILE", "VINYL", "LVT", "VCT", "PORCELAIN", "CERAMIC", "LINOLEUM"]);
// longest phrase first, so WALL BASE is consumed before BASE is tried
const PHRASES = WORD_PHRASES.map(([p, c]) => ({ w: p.split(" "), c })).sort((a, b) => b.w.length - a.w.length);

/** Some word before index i is W (from W/) or WITH, and some word before that is a floor surface. */
const withFloorBefore = (t: string[], i: number): boolean => {
  return t.some((x, k) => k < i && (x === "W" || x === "WITH") && t.slice(0, k).some((f) => FLOOR_SURFACES.has(f)));
};

/** The category a row's item words name, or "none". Words split on spaces,
 *  "/", ",", "(" and ")" (a hyphen compound is one word: WALL-MOUNTED) and
 *  lose the punctuation around them (BASE. / "COVE BASE" / BASE:); the " — "
 *  between two cells, all punctuation, is a word of its own, so no phrase
 *  spans two cells. A STAIR TREAD's NOSING belongs to the tread. Two
 *  categories named in one row → "none" (a guess would be a coin toss). A base
 *  phrase after "<floor surface> W/" or "… WITH" is the floor's own base, so
 *  it names nothing (consumed, like an exclusion). */
export function b4(item: string): WordCategory | "none" {
  const t = item.toUpperCase().split(/[\s/,()]+/).filter(Boolean)
    .map((w) => w.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "") || w);
  const used = t.map(() => false);
  if (t.some((w) => w === "TREAD" || w === "TREADS")) t.forEach((w, i) => { if (w === "NOSING" || w === "NOSINGS") used[i] = true; });
  const hits = new Set<WordCategory>();
  for (const p of PHRASES) {
    for (let i = 0; i + p.w.length <= t.length; i++) {
      if (!p.w.every((w, j) => !used[i + j] && t[i + j] === w)) continue;
      for (let j = 0; j < p.w.length; j++) used[i + j] = true;
      if (p.c === "base" && withFloorBefore(t, i)) continue;
      if (p.c) hits.add(p.c);
    }
  }
  return hits.size === 1 ? [...hits][0] : "none";
}

// ── "/" read as "7" ──────────────────────────────────────────────────────────
const HAS_LETTER = /\p{L}/u;
// a dimension's "by" (4 X 7 IN): a 7 beside it is a size
const BY = /^[X×]$/i;
const bareWord = (w: string) => w.toUpperCase().replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");
// a word that introduces a number (TYPE 7, SERIES 7, NO. 7, # 7): the 7
// after it is that number
// (not STYLE or SIZE: "STYLE / COLOR" and "SIZE / FINISH" are common pairs)
const NUMBER_WORDS = new Set(["NO", "TYPE", "SERIES", "CLASS", "GRADE", "MODEL", "PHASE", "SECTION", "GAUGE"]);
const numbers = (w: string) => w === "#" || NUMBER_WORDS.has(bareWord(w));

/** An OCR read's item words with a "/" the reader read as "7" put back
 *  (#482). On a scan, "CARPET / BROADLOOM" reads "CARPET 7 BROADLOOM" and
 *  "EPOXY FLOORING W/" reads "… W7", which b4 then can't tell from a base
 *  item. A word that is exactly "7", with a word on each side and a letter
 *  in at least one of them ("BASE 7 4 IN"), becomes "/", unless one of them
 *  is a dimension's X ("4 X 7 IN" is a size) or the word before it
 *  introduces a number ("TYPE 7 TILE", "NO. 7"); a "W7" after a
 *  floor surface word in the same text becomes "W/", at the text's end too
 *  (its base may sit in the next cell). Nothing else: a 7 at either end, a 7
 *  glued to a word, a W7 with no floor word before it (a wall type). Text
 *  with nothing to repair comes back as given; repaired text is rejoined
 *  with single spaces. Accepted cost: a printed lone 7 between two words in
 *  these cells reads as "/". */
export function repairSlashSeven(text: string): string {
  const t = text.trim().split(/\s+/);
  let changed = false;
  const out = t.map((w, i) => {
    const [a, b] = [t[i - 1], t[i + 1]];
    if (w === "7" && a !== undefined && b !== undefined && !BY.test(a) && !BY.test(b) && !numbers(a) && (HAS_LETTER.test(a) || HAS_LETTER.test(b))) { changed = true; return "/"; }
    if (/^W7$/i.test(w) && t.slice(0, i).some((f) => FLOOR_SURFACES.has(bareWord(f)))) { changed = true; return w[0] + "/"; }
    return w;
  });
  return changed ? out.join(" ") : text;
}

// ── rows ─────────────────────────────────────────────────────────────────────
/** Distinct non-empty cells, in the given order, joined " — ". */
const joinParts = (parts: Array<string | undefined>): string =>
  [...new Set(parts.map((p) => (p ?? "").trim()).filter(Boolean))].join(" — ");
const cellsOf = (r: TableRow, ...cols: string[]) => cols.map((c) => r.cells[c]?.text);
/** The first non-empty of the given cells. */
const firstCell = (r: TableRow, ...cols: string[]): string => {
  for (const c of cols) { const v = r.cells[c]?.text?.trim(); if (v) return v; }
  return "";
};
/** Headings whose rows start unticked: a flooring estimator rarely takes
 *  ceilings or millwork off a finish schedule, but can opt one in. */
const UNTICKED = new Set<FinishSection>(["CEILINGS", "CEILING", "MILLWORK"]);

/** The cells repairSlashSeven reads: what the item is, never its look. */
const SLASH_COLS = ["MATERIAL", "DESCRIPTION", "PRODUCT"];

/** `keyCol`: the table's key column (its first header). `ocr`: the row was
 *  read from the on-device reader's words, so its item cells get their "/"
 *  back (repairSlashSeven) before the category and description read them;
 *  a copy, never the reader's row. */
function toRow(r: TableRow, keyCol: string, { ocr = false }: { ocr?: boolean } = {}): ScheduleRow {
  if (ocr) {
    const cells = { ...r.cells };
    for (const c of SLASH_COLS) if (c !== keyCol && cells[c]) cells[c] = { ...cells[c], text: repairSlashSeven(cells[c].text) };
    r = { ...r, cells };
  }
  const section = r.section;
  const heading = section ? FINISH_SECTION_CATEGORY[section] : null;
  let category: Category = "unassigned", source: CategorySource = "none";
  if (heading) { category = heading; source = "heading"; }
  else {
    // no printed heading names one (none printed, or MISC / ACCESSORIES):
    // the row's item words decide — MATERIAL and DESCRIPTION only, never
    // PRODUCT, style or remarks (a product line called STYLE-A BASE is a floor)
    const w = b4(joinParts(cellsOf(r, "MATERIAL", "DESCRIPTION")));
    if (w !== "none") { category = w; source = "text"; }
  }
  const row: ScheduleRow = {
    finish_tag: r.key,
    section: section ?? "",
    category,
    category_source: source,
    // a key-cell qualifier ("CUT (C)" of "FTB-01 CUT (C)") leads the
    // description; it never names the category
    description: joinParts([r.qualifier, ...cellsOf(r, "MATERIAL", "DESCRIPTION", "PRODUCT")]),
    manufacturer: firstCell(r, "MANUFACTURER"),
    style: firstCell(r, "STYLE"),
    spec_color: firstCell(r, "COLOR"),
    size: firstCell(r, "SIZE"),
    remarks: firstCell(r, "REMARKS", "COMMENTS"),
    suggested: !(source === "heading" && section && UNTICKED.has(section)),
  };
  // the schedule marks the row NOT USED / N.I.C. — after its code in the key
  // cell, or as the whole of another cell: it starts unticked, and says why
  const marker = r.notUsed ? r.notUsedText ?? "" : notUsedCell(r, keyCol);
  if (marker != null) { row.suggested = false; row.unticked_reason = "not-used"; row.not_used_text = marker; }
  if (r.keyRule) row.key_rule = r.keyRule;
  return row;
}

/** A non-key cell whose whole text is a NOT USED / N.I.C. marker, as printed
 * (leading separators stripped); null when there is none. */
function notUsedCell(r: TableRow, keyCol: string): string | null {
  for (const [col, c] of Object.entries(r.cells)) {
    if (col !== keyCol && normalizeNotUsed(c.text)) return c.text.trim().replace(/^[-–—:,\s]+/, "");
  }
  return null;
}

/** The share of a's area that b covers (sheetgraph.ts's overlapFrac). */
const overlapFrac = (a: Bbox, b: Bbox): number => {
  const w = Math.min(a[2], b[2]) - Math.max(a[0], b[0]), h = Math.min(a[3], b[3]) - Math.max(a[1], b[1]);
  if (w <= 0 || h <= 0) return 0;
  return (w * h) / Math.max(1, (a[2] - a[0]) * (a[3] - a[1]));
};

/** Read the spans inside a marquee (image px, the graph's span shape) as one
 *  finish/material schedule, or say why not. opts.ocr: the spans are the
 *  on-device reader's words, so a blank band between two code groups ends the
 *  section (sheetgraph.ts ExtractOpts.resetAtBlankBand); the vector read
 *  never sets it. */
export function readScheduleSpans(spans: GraphSpan[], opts?: { ocr?: boolean }): ScheduleRead {
  const parsed = readParsed(spans, opts);
  const first = parsed.read;
  // A box that read rows gets one more look with its alias headers renamed
  // (secondLook). A box that read no rows gets one with its layout normalized
  // (scheduleReshape.ts, #483): alias headers, a key column printed second,
  // a legend with no header row. Never after a refusal by title: a DOOR
  // SCHEDULE stays refused however its columns are arranged.
  if (first.rows.length) return secondLook(parsed, spans, (s) => readParsed(s, opts), (p) => p).read;
  if ("refused" in first && first.refused === "title") return first;
  const reshaped = reshapeBox(spans);
  if (!reshaped) return first;
  const second = readBox(reshaped.spans, opts);
  return second.rows.length && second.rows.length >= reshaped.codes ? second : first;
}

/** A read and the parsed table its rows come from, row for row. */
interface Parsed { read: ScheduleRead; table: ScheduleTable | null }

/** The look at a box that already read rows: its alias headers renamed
 *  (reshapeBox aliasesOnly), read again with `read`, and that read used only
 *  when movedOnlyAliasCells says the alias columns' own cells are all that
 *  moved. readScheduleSpans and readScheduleDebug both decide here; `of`
 *  takes the read and its table out of what `read` returns. */
function secondLook<T>(first: T, spans: GraphSpan[], read: (s: GraphSpan[]) => T, of: (t: T) => Parsed): T {
  const look = reshapeBox(spans, { aliasesOnly: true });
  if (!look) return first;
  const second = read(look.spans);
  return movedOnlyAliasCells(of(first), of(second), spans, look) ? second : first;
}

const wordsIn = (s: string | undefined) => (s ?? "").split(/\s+/).filter(Boolean);
const sameWords = (a: string[], b: string[]) => a.length === b.length && a.every((w, i) => w === b[i]);
/** Each word of b, counted, minus those of a: what b has that a hasn't. */
const gained = (a: string[], b: string[]): string[] => {
  const left = new Map<string, number>();
  for (const w of a) left.set(w, (left.get(w) ?? 0) + 1);
  return b.filter((w) => { const n = left.get(w) ?? 0; left.set(w, n - 1); return n <= 0; });
};
/** The words taken out of a to leave b, in order; null when b isn't a with words taken out. */
const takenOut = (a: string[], b: string[]): string[] | null => {
  const out: string[] = [];
  let j = 0;
  for (const w of a) { if (j < b.length && w === b[j]) j++; else out.push(w); }
  return j === b.length ? out : null;
};

/** The rows of `second` matched to `first`'s, index for index, and its rows
 *  whose code `first` skipped; null unless
 *  (a) the rows are the same (finish_tag and section, in order) apart from
 *      rows whose code `first` skipped (EPOX, whose cells sat in one column);
 *  (b) code_checks, ocr_code, read_as and key_rule are the same;
 *  (c) skipped only shrinks, each code leaving it read as one of those rows. */
function matchRows(first: ScheduleRead, second: ScheduleRead): { pairs: Array<[number, number]>; extra: number[] } | null {
  if ("refused" in second) return null;
  const skipped = ("skipped" in first && first.skipped) || [];
  const stillSkipped = ("skipped" in second && second.skipped) || [];
  const pairs: Array<[number, number]> = [], extra: number[] = [];
  let i = 0;
  for (const [j, r] of second.rows.entries()) {
    const f = first.rows[i];
    if (f && f.finish_tag === r.finish_tag && f.section === r.section) { pairs.push([i, j]); i++; }
    else if (skipped.includes(r.finish_tag)) extra.push(j);
    else return null;
  }
  if (i !== first.rows.length) return null;
  const extraTags = extra.map((j) => second.rows[j].finish_tag);
  if (gained(skipped, [...stillSkipped, ...extraTags]).length || stillSkipped.length + extraTags.length !== skipped.length) return null;
  for (const [i, j] of pairs) {
    const f = first.rows[i], r = second.rows[j];
    if (JSON.stringify(f.code_checks) !== JSON.stringify(r.code_checks) || f.ocr_code !== r.ocr_code || f.read_as !== r.read_as || f.key_rule !== r.key_rule) return null;
  }
  return { pairs, extra };
}

/** @internal Exported for tests: matchRows's row guards alone. */
export function sameRead(first: ScheduleRead, second: ScheduleRead): boolean {
  return matchRows(first, second) !== null;
}

/** Whether the renamed read moved each alias column's own cells and nothing
 *  else. An alias column's own spans are the spans below the header whose x
 *  range overlaps its header cell's printed text and no other header cell's
 *  (a span under two header cells: no); each sits in one row of the renamed
 *  read, by the rows' printed extents (a span between rows: no). Then, in
 *  each row the first read had, the renamed column's cell is exactly its
 *  spans' words, in print order; and every other cell is the first read's,
 *  less only those words (taken from wherever the first read put them). So a
 *  row's category, read from its section and its MATERIAL and DESCRIPTION
 *  cells, changes only when the alias words leave one of those cells. A row
 *  `first` skipped has its renamed cells checked the same way, and an alias
 *  column with spans only in such rows is not used (a notes block beside the
 *  header could be the only text in it). */
function movedOnlyAliasCells(a: Parsed, b: Parsed, spans: GraphSpan[], look: AliasReshaped): boolean {
  const match = matchRows(a.read, b.read);
  const ta = a.table, tb = b.table;
  if (!match || !ta || !tb || ta.rows.length !== a.read.rows.length || tb.rows.length !== b.read.rows.length) return false;
  const right = (t: GraphSpan) => t.x + (t.w || 0);
  const mid = (t: GraphSpan) => t.y + (t.h || 0) / 2;
  const over = (s: GraphSpan, t: GraphSpan) => Math.min(right(s), right(t)) - Math.max(s.x, t.x) > 0;
  const renamedCells = new Set(look.renamed.map((c) => c.cell));
  const others = look.header.filter((t) => !renamedCells.has(t));
  const headerBottom = Math.max(...look.header.map((t) => t.y + (t.h || 0)));
  const extents = tb.rows.map((r) => {
    const boxes = Object.values(r.cells).map((c) => c.bbox);
    return [Math.min(...boxes.map((x) => x[1])), Math.max(...boxes.map((x) => x[3]))];
  });
  const tableBottom = Math.max(...extents.map((e) => e[1]));
  // own[c][j]: renamed column c's spans in row j of the renamed read
  const own = look.renamed.map(() => tb.rows.map((): GraphSpan[] => []));
  for (const s of spans) {
    if (look.header.includes(s) || mid(s) <= headerBottom || mid(s) > tableBottom) continue;
    const under = look.renamed.flatMap((c, i) => (over(s, c.cell) ? [i] : []));
    if (!under.length) continue;
    if (under.length > 1 || others.some((t) => over(s, t))) return false;
    const rows = extents.flatMap((e, j) => (mid(s) >= e[0] && mid(s) <= e[1] ? [j] : []));
    if (rows.length !== 1) return false;
    own[under[0]][rows[0]].push(s);
  }
  const printOrder = (p: GraphSpan, q: GraphSpan) => (Math.abs(mid(p) - mid(q)) > Math.min(p.h || 10, q.h || 10) / 2 ? mid(p) - mid(q) : p.x - q.x);
  const ownWords = (c: number, j: number) => [...own[c][j]].sort(printOrder).flatMap((s) => wordsIn(s.str));
  // each renamed column's cell is its own spans' words, in every row of the renamed read
  for (const [c, rn] of look.renamed.entries()) {
    for (const [j, r] of tb.rows.entries()) if (!sameWords(wordsIn(r.cells[rn.to]?.text), ownWords(c, j))) return false;
    if (own[c].some((x) => x.length) && !match.pairs.some(([, j]) => own[c][j].length)) return false;
  }
  const targets = new Set(look.renamed.map((c) => c.to));
  for (const [i, j] of match.pairs) {
    const f = ta.rows[i], r = tb.rows[j];
    const moved = look.renamed.flatMap((_, c) => ownWords(c, j));
    const taken: string[] = [];
    for (const col of new Set([...Object.keys(f.cells), ...Object.keys(r.cells)])) {
      const was = wordsIn(f.cells[col]?.text), now = wordsIn(r.cells[col]?.text);
      if (targets.has(col)) { if (was.length) return false; continue; }
      if (sameWords(was, now)) continue;
      const out = takenOut(was, now);
      if (!out) return false;
      taken.push(...out);
    }
    if (taken.length !== moved.length || gained(moved, taken).length) return false;
  }
  return true;
}

/** The read of a box, and the parsed table its rows come from. */
function readParsed(spans: GraphSpan[], opts?: { ocr?: boolean }): Parsed {
  const parsed = readFinishMarquee({ key: "crop", spans }, { ocr: !!opts?.ocr });
  const original = readOf(parsed, spans, !!opts?.ocr);
  const table = parsed && parsed.kind === "table" ? parsed.table : null;
  if (!opts?.ocr || !parsed || parsed.kind !== "table" || "refused" in original) return { read: original, table };
  return recoverNumericCodeRows(parsed, original, spans);
}

function readBox(spans: GraphSpan[], opts?: { ocr?: boolean }): ScheduleRead {
  return readParsed(spans, opts).read;
}

/** A numeric-only first read (88-2) is not a finish key, so the parser
 * can absorb its description into the preceding row. A code-shaped second
 * read can locate that row, but cannot establish its identity. Reparse only
 * inside an already accepted finish table, keeping its existing keys, then
 * expose each recovered row with an EMPTY code: the person must enter it.
 * No alternate becomes a condition tag and no input span is rewritten. */
function recoverNumericCodeRows(parsed: Extract<MarqueeRead, { kind: "table" }>, original: ScheduleRead, spans: GraphSpan[]): Parsed {
  const kept: Parsed = { read: original, table: parsed.table };
  const table = parsed.table;
  const keyBoxes = table.rows.flatMap(r => r.cells[table.headers[0]] ? [r.cells[table.headers[0]].bbox] : []);
  if (!keyBoxes.length) return kept;
  const left = Math.min(...keyBoxes.map(b => b[0]));
  const right = Math.max(...keyBoxes.map(b => b[2]));
  const inside = (s: GraphSpan, b: Bbox) => s.x + s.w / 2 >= b[0] && s.x + s.w / 2 <= b[2] && s.y + s.h / 2 >= b[1] && s.y + s.h / 2 <= b[3];
  // The table's region ends at the last row it keyed, so a misread on the
  // LAST row lies below it: look one row pitch further down (#511 review).
  const mids = keyBoxes.map(b => (b[1] + b[3]) / 2).sort((a, b) => a - b);
  const gaps = mids.slice(1).map((m, i) => m - mids[i]).filter(g => g > 0).sort((a, b) => a - b);
  const pitch = gaps.length ? gaps[Math.floor(gaps.length / 2)] : 2 * (keyBoxes[0][3] - keyBoxes[0][1]);
  // Each candidate found below the region reaches one pitch further, so two
  // misreads in a row at the end both recover (#517 review).
  const shaped = spans.filter(s => /^[0-9]+[-.][0-9]+$/.test(s.str.trim())
    && !!s.codeAlternate && finishCodeOk(s.codeAlternate) && /[A-Z]/i.test(s.codeAlternate)
    && s.x + s.w / 2 >= left && s.x + s.w / 2 <= right
    && s.y + s.h / 2 >= table.region[1]).sort((a, b) => a.y - b.y);
  let bottom = Math.max(table.region[3], mids[mids.length - 1] + 1.5 * pitch);
  const candidates: GraphSpan[] = [];
  for (const s of shaped) {
    if (s.y + s.h / 2 > bottom) break;
    candidates.push(s);
    bottom = Math.max(bottom, s.y + s.h / 2 + 1.5 * pitch);
  }
  if (!candidates.length) return kept;
  const candidateSet = new Set(candidates);
  const reparsed = readFinishMarquee({ key: "crop", spans: spans.map(s => candidateSet.has(s) ? { ...s, str: s.codeAlternate! } : s) }, { ocr: true });
  if (!reparsed || reparsed.kind !== "table") return kept;
  const read = readOf(reparsed, spans, true);
  if ("refused" in read) return kept;
  const recovered = new Map<number, GraphSpan>();
  reparsed.table.rows.forEach((r, i) => {
    const box = r.cells[reparsed.table.headers[0]]?.bbox;
    const candidate = box && candidates.find(s => inside(s, box));
    if (candidate) recovered.set(i, candidate);
  });
  // Refuse a reparse that loses, reorders or renames an established identity.
  const oldKeys = original.rows.map(r => r.finish_tag);
  const keptKeys = read.rows.filter((_, i) => !recovered.has(i)).map(r => r.finish_tag);
  if (!recovered.size || JSON.stringify(oldKeys) !== JSON.stringify(keptKeys)) return kept;
  return { table: reparsed.table, read: { ...read, rows: read.rows.map((row, i) => {
    const candidate = recovered.get(i);
    if (!candidate) return row;
    const result = { ...row, finish_tag: "", suggested: false, code_checks: [{ first: candidate.str, second: candidate.codeAlternate! }] };
    delete result.read_as;
    return result;
  }) } };
}

/** @internal Tests only: the primary read (before numeric-row recovery)
 * plus how the marquee rules got there — the table's rows with their
 * provenance kept (`_y`, `_pass1`, `_pass1Key`, `_newRule`, `_ungluedFrom`),
 * the lines they consumed, and the per-line decisions. */
export function readScheduleDebug(spans: GraphSpan[], opts?: { ocr?: boolean }): { read: ScheduleRead } & Omit<ReturnType<typeof traceFinishMarquee>, "read"> {
  const trace = (s: GraphSpan[]) => {
    const t = traceFinishMarquee({ key: "crop", spans: s }, { ocr: !!opts?.ocr });
    return { read: readOf(t.read, s, !!opts?.ocr), rows: t.rows, consumed: t.consumed, diag: t.diag, table: t.read && t.read.kind === "table" ? t.read.table : null };
  };
  // the same second looks readScheduleSpans takes, traced on the reshaped
  // box; like for like where the read recovers no numeric code (the trace
  // is taken before that recovery)
  const first = trace(spans);
  if (first.read.rows.length) return secondLook(first, spans, trace, (t) => t);
  if ("refused" in first.read && first.read.refused === "title") return first;
  const reshaped = reshapeBox(spans);
  const second = reshaped ? trace(reshaped.spans) : null;
  return second && second.read.rows.length && second.read.rows.length >= reshaped!.codes ? second : first;
}

/** `ocr`: the spans are the on-device reader's words, so a code it misread
 *  (PT-O1, $SM-1) is repaired, and the row keeps what it read (read_as); its
 *  item words get their "/" back (toRow). */
function readOf(r: MarqueeRead | null, spans: GraphSpan[], ocr: boolean): ScheduleRead {
  if (!r) return { rows: [], refused: "no-table" };
  if (r.kind === "headerOnly") {
    // a header with no row read under it, and nothing the reader saw but
    // skipped: no table, as before. With skipped codes it is a table whose
    // codes were all skipped — guarded like any table, then read as no rows.
    if (!r.skipped.length) return { rows: [], refused: "no-table" };
    const title = r.title?.text;
    if (title && isNonFinishSchedule(title)) return { rows: [], refused: "title", title };
    const why = refusalOf(title, r.headers, r.headerWords, r.hasSection, r.region, spans);
    if (why) return { rows: [], refused: why, ...(title ? { title } : {}) };
    return { rows: [], skipped: [...r.skipped] };
  }
  if (!r.table.rows.length) return { rows: [], refused: "no-table" };
  const t = r.table;
  const title = t.title?.text;
  if (r.kind === "other-family") return { rows: [], refused: "title", ...(title ? { title } : {}) };
  const why = refusalOf(title, t.headers, r.headerWords, r.hasSection, r.guardRegion, spans);
  if (why) return { rows: [], refused: why, ...(title ? { title } : {}) };
  const rows = t.rows.map((x) => {
    const row = toRow(x, t.headers[0], { ocr });
    const keyCell = x.cells[t.headers[0]]?.text ?? "";
    if (ocr) {
      row.ocr_code = true;
      const fix = repairKey(keyCell, row.finish_tag);
      row.finish_tag = fix.key;
      if (fix.readAs) row.read_as = fix.readAs;
      const box = x.cells[t.headers[0]]?.bbox;
      const checks = box ? spans.filter((s) => s.codeAlternate !== undefined
        && s.x + s.w / 2 >= box[0] && s.x + s.w / 2 <= box[2]
        && s.y + s.h / 2 >= box[1] && s.y + s.h / 2 <= box[3])
        .map((s) => ({ first: s.str, second: s.codeAlternate! })) : [];
      if (checks.length) { row.code_checks = checks; row.suggested = false; }
    }
    // A code printed or read with a parenthesis that has no partner
    // (FT-0B(C) keys without it rather than folding into the row above,
    // and says so (#510 review).
    // Balance is judged over the whole key cell, part by part, as
    // finishKeyText keys it: "G-01(C )" is balanced, "G-01 (C" is not.
    const cell = keyCell.trim().toUpperCase();
    const unpaired = cell.split("/").some((p) => (p.match(/\(/g) || []).length !== (p.match(/\)/g) || []).length);
    if (!row.read_as && unpaired) row.read_as = cell;
    return row;
  });
  return r.skipped.length ? { rows, skipped: [...r.skipped] } : { rows };
}

/** The refusal a finish-shaped read earns (other than its title), or null.
 *  `region`: the table's own ink as the guards see it (a table's pass-1
 *  region, a headerOnly read's header band). */
function refusalOf(title: string | undefined, headers: string[], headerWords: string[], hasSection: boolean, region: Bbox, spans: GraphSpan[]): RefusalReason | null {
  // A device schedule shares MARK / DESCRIPTION / MANUFACTURER with a
  // materials table, so the finish reader takes it too; the equipment reader's
  // device columns (GPM, HP, MBH, NECK, LUMENS …) are the proof it is not one.
  // The header guard below does not list those words — this re-read does.
  // Only a device table on the finish table's own ink counts (the sheet
  // graph's rule, buildSheetGraph: half the finish region overlapped → it is
  // the equipment table): a heater schedule elsewhere in the box says nothing
  // about this one. Both ways round: a marquee read keeps every keyed row in
  // the box, so it can run on into a device table printed below and take its
  // rows — then the device table lies mostly inside the finish region. And a table that says finish itself — a CODE key, a
  // printed finish heading, a title naming FINISH or MATERIAL — is not
  // refused for one column a device schedule also prints (WASTE, MOUNTING).
  // Item + MANUFACTURER is not that evidence: a pump schedule has both.
  const saysFinish = headers[0] === "CODE" || hasSection || /\b(FINISH|MATERIAL)/.test((title ?? "").toUpperCase());
  if (!saysFinish) {
    const eq = extractTables({ key: "crop", spans }, "equipment", { buildings: new Set() });
    if (eq.some((e) => overlapFrac(region, e.region) >= 0.5 || overlapFrac(e.region, region) >= 0.5)) return "equipment";
  }
  return headerRefusal(headers, headerWords, hasSection);
}

/**
 * Legacy entry: positioned tokens (baseline-left origin, as extractRegionText
 * emits them) already cropped to the marquee. Each becomes a width-less span
 * (a token's optional w and ang are not read); a refusal reads as no rows. [] when nothing is found — the
 * caller says "no schedule here" rather than inventing rows.
 */
export function parseSchedule(tokens: Token[]): ScheduleRow[] {
  const spans = tokens.map((t) => ({ str: t.str, x: t.x, y: t.y - t.h, w: 0, h: t.h }));
  return readScheduleSpans(spans).rows;
}
