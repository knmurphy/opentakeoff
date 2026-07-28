// Plan-set search index — "which sheet says CPT-1?" across the whole set.
//
// Pure, DOM-free, pdfjs-free (the sheets.ts / oneclick.ts / detectRooms.ts
// precedent): callers hand over text already resolved to image px — the exact
// shape extractRegionText() returns — so this runs identically under the browser
// canvas, the gallery, the MCP server's node session, and node:test.
//
// Why hand-rolled and not MiniSearch/FlexSearch: a plan sheet carries ~1k text
// runs (measured on demo/sample-finish-plan.pdf), so a 200-sheet set is ~200k
// tokens — three orders of magnitude below where those libraries start earning
// their keep. web/package.json runs on 6 runtime deps; an inverted Map is not
// worth a seventh. See docs/CLIENT_SIDE_OCR_RESEARCH.md §6.
//
import { parseSheetKey, compareSheetKeys } from "./sheetKey";

// The index is deliberately SOURCE-TAGGED. A vector sheet's text layer is exact;
// an OCR'd scan is ~80% of searchable terms with junk mixed in (measured, §9 of
// the same doc). Both are worth indexing, but a hit must be able to say which it
// came from — the same badge-then-verify posture raster One-Click already takes.

/** One positioned text run in image px at RENDER_SCALE — structurally identical
 *  to extractRegionText()'s Token and detectRooms' PositionedTextItem, so any of
 *  the three feeds this without a shim. */
export interface IndexedTextItem {
  str: string;
  x: number;
  y: number;
  h?: number;
}

export type IndexSource = "text" | "ocr";

/** A sheet's built index. Plain JSON (Record + arrays, no Map/Set) so it can go
 *  straight into the meta store next to the annotations — see store.js's
 *  keyPath-less META_STORE and its TPL_KEY/MATLIB_KEY/STAMPLIB_KEY precedent. */
export interface SheetIndex {
  key: string;
  source: IndexSource;
  builtAt: number;
  /** term → flat [x0,y0, x1,y1, …] anchors, capped at MAX_ANCHORS. The units are
   *  the px of whatever viewport the caller extracted with — described by w/h
   *  below, so a consumer never has to know or guess which scale that was. */
  terms: Record<string, number[]>;
  /** the anchor space: viewport width/height in the same px the anchors use. 0
   *  when the caller supplied none, which normalizedAnchor reports honestly
   *  rather than guessing a scale. */
  w: number;
  h: number;
  /** total tokens seen AS DRAWN, including ones dropped as unsearchable and
   *  counting repeats — the honest denominator for "did this sheet have text at
   *  all". Not a distinct-term count, and not the size of `terms`: one token can
   *  expand into several terms (see expandTerm). Zero means a text-less sheet. */
  tokenCount: number;
}

/** Anchors kept per term per sheet. A search hit needs somewhere to jump, not a
 *  concordance; 8 covers "next match" cycling without letting a sheet that says
 *  ROOM 200 times blow up the stored index. */
export const MAX_ANCHORS = 8;

/** Shortest plain word that earns a slot. Below this, tokens are list numbering
 *  ("1."), stray dimension letters, and leader-line crumbs — measured as ~13% of
 *  a real sheet's runs and never what anyone types. Room/tag-shaped tokens are
 *  admitted regardless of length by isCode(). */
export const MIN_TERM_LEN = 3;

/** Finish / spec / material tag: CPT-1, LVT3, ACT-2, P-1, PT-2A. The vocabulary
 *  estimators actually search a finish plan for. */
export const TAG_RE = /^[A-Z]{1,4}-?\d{1,2}[A-Z]?$/;
/** Room-number label — the SAME shape detectRooms.ts seeds One-Click floods on
 *  (ROOM_LABEL_RE). Kept as its own literal rather than imported: detectRooms
 *  owns a geometry contract, this owns a text one, and they are free to drift. */
export const ROOM_RE = /^\d{2,3}[A-Z]?$/;
/** Sheet number as the title block writes it: A101, A-101, S1.1, AF101. */
export const SHEET_NO_RE = /^[A-Z]{1,3}-?\d{1,3}(\.\d{1,2})?[A-Z]?$/;

/** Is this a code an estimator would type — tag, room number, or sheet number?
 *  Codes bypass MIN_TERM_LEN: "P-1" is three chars of real signal. */
export function isCode(term: string): boolean {
  return TAG_RE.test(term) || ROOM_RE.test(term) || SHEET_NO_RE.test(term);
}

/** Worth an index slot? Mirrors the "searchable term" definition the OCR spike
 *  scored against (docs/CLIENT_SIDE_OCR_RESEARCH.md §9.3), so the 80%-coverage
 *  number quoted there is a number about THIS predicate, not a different one. */
export function isSearchable(term: string): boolean {
  return term.length >= MIN_TERM_LEN || isCode(term);
}

/** Normalize one raw token to its index form: upper-case, and strip punctuation
 *  from the ENDS only. Interior '-', '.', '/' and '#' are load-bearing on a plan
 *  ("CPT-1", "S1.1", "PT-1/PT-2"), so stripping them globally would shred the
 *  exact vocabulary this index exists to find. Returns "" for a token that is
 *  nothing but punctuation. */
export function normalizeTerm(raw: string): string {
  return (raw || "")
    .toUpperCase()
    .replace(/^[^A-Z0-9]+/, "")
    .replace(/[^A-Z0-9]+$/, "");
}

/** Split one text run into candidate terms. A single pdf.js run routinely
 *  carries a whole label ("OFFICE 101", "PATIENT ROOM"), so runs are split on
 *  whitespace — the same tokenization detectRooms' roomLabelSeeds does when it
 *  hunts a room number inside a longer run. */
export function splitRun(str: string): string[] {
  return (str || "").split(/\s+/);
}

/** One normalized token → every term it should be findable under.
 *
 *  A two-material callout is written as ONE whitespace-delimited token —
 *  "PT-1/PT-2", "CPT-1,LVT-2" — and indexing only the whole thing makes the
 *  right-hand half silently unfindable: a search for PT-2 misses a sheet that
 *  plainly specifies PT-2. So a token joined by '/' or ',' is indexed under the
 *  whole AND each part.
 *
 *  Only '/' and ',' split. '-' and '.' must NOT: they are internal to single
 *  codes ("CPT-1", "S1.1"), and splitting them would shred the vocabulary this
 *  index exists to find — the same reason normalizeTerm keeps them.
 *
 *  The whole is kept so typing the callout exactly as drawn still matches, and
 *  so a term like "AND/OR" doesn't lose its literal form. */
export function expandTerm(term: string): string[] {
  if (!term.includes("/") && !term.includes(",")) return [term];
  const out = [term];
  for (const part of term.split(/[/,]+/)) {
    const p = normalizeTerm(part);
    if (p && p !== term && !out.includes(p)) out.push(p);
  }
  return out;
}

/** Build one sheet's index from its positioned text.
 *
 *  Anchors are the run's own origin, not the sub-token's: pdf.js gives a
 *  transform per RUN, and interpolating a per-word x would be inventing
 *  precision the text layer never had. For "jump to the match" that is plenty —
 *  the run origin is inside the label the user searched for. */
export function buildSheetIndex(
  key: string,
  items: IndexedTextItem[],
  source: IndexSource = "text",
  builtAt = 0,
  size: { w: number; h: number } = { w: 0, h: 0 },
): SheetIndex {
  const terms: Record<string, number[]> = {};
  let tokenCount = 0;
  for (const it of items || []) {
    for (const raw of splitRun(it.str)) {
      const token = normalizeTerm(raw);
      if (!token) continue;
      tokenCount++;   // counts TOKENS as drawn, not the terms they expand into
      for (const term of expandTerm(token)) {
        if (!isSearchable(term)) continue;
        const anchors = (terms[term] ??= []);
        if (anchors.length < MAX_ANCHORS * 2) anchors.push(it.x, it.y);
      }
    }
  }
  return { key, source, builtAt, terms, tokenCount, w: size.w || 0, h: size.h || 0 };
}

/** One sheet that matched, with what it matched on and where to jump. */
export interface SheetHit {
  key: string;
  source: IndexSource;
  score: number;
  /** the index term each QUERY TOKEN matched, in query order (not ranked) —
   *  matched[i] is what tokens[i] hit, so it lines up with what the user typed */
  matched: string[];
  /** first anchor of the term matched by the FIRST query token, image px — or
   *  null if unanchored. Not a "best" anchor: there is no cross-term ranking. */
  anchor: [number, number] | null;
}

/** Terms in `index` that match one query token: exact hit, else every term that
 *  starts with it. Prefix matching is what makes a half-typed "CPT" useful, and
 *  an exact hit short-circuits so typing the full "CPT-1" doesn't also drag in
 *  CPT-10 ahead of it. */
export function matchTerm(index: SheetIndex, token: string): string[] {
  if (index.terms[token]) return [token];
  const out: string[] = [];
  for (const term in index.terms) if (term.startsWith(token)) out.push(term);
  return out;
}

/** Search a plan set.
 *
 *  AND across query tokens: "cpt-1 corridor" means the sheet showing BOTH, which
 *  is how someone narrows a 200-sheet set. OR would return the whole set for any
 *  common word and make the feature useless at exactly the size it matters.
 *
 *  Scoring favours, in order: an exact term hit over a prefix one (×4), a code
 *  over prose (×2 — someone typing CPT-1 wants the finish plan, not the note
 *  that mentions it), and more occurrences on the sheet. A text-layer sheet
 *  outranks an OCR'd one on a tie, because its terms are exact rather than ~80%
 *  right; ties after that break on sheet key so results never reshuffle between
 *  identical searches.
 */
export function searchPlan(indexes: Iterable<SheetIndex>, query: string): SheetHit[] {
  const tokens = splitRun(query).map(normalizeTerm).filter(Boolean);
  if (!tokens.length) return [];
  const hits: SheetHit[] = [];
  for (const index of indexes) {
    let score = 0;
    const matched: string[] = [];
    let ok = true;
    for (const token of tokens) {
      const terms = matchTerm(index, token);
      if (!terms.length) { ok = false; break; }
      let best = 0, bestTerm = terms[0];
      for (const term of terms) {
        const occurrences = (index.terms[term]?.length ?? 0) / 2;
        const s = occurrences * (term === token ? 4 : 1) * (isCode(term) ? 2 : 1);
        if (s > best) { best = s; bestTerm = term; }
      }
      score += best;
      matched.push(bestTerm);
    }
    if (!ok) continue;
    // an OCR'd sheet's terms are ~80% right, so it loses a tie to a text sheet
    if (index.source === "ocr") score *= 0.5;
    const anchors = index.terms[matched[0]];
    hits.push({
      key: index.key,
      source: index.source,
      score,
      matched,
      anchor: anchors?.length ? [anchors[0], anchors[1]] : null,
    });
  }
  // Ties break on the repo's CANONICAL sheet order, not a raw string compare:
  // localeCompare puts "plan.pdf#10" before "plan.pdf#2", and sheetKey.ts exists
  // so every sheet-ordered surface (by-sheet totals, the report, the Marked Set
  // PDF) can never drift apart. Search results are one more such surface.
  return hits.sort((a, b) => b.score - a.score || compareSheetKeys(a.key, b.key));
}

/** An anchor as a 0..1 fraction of the sheet, or null when this index recorded
 *  no anchor space.
 *
 *  Normalized is the app's cross-surface convention: markups store positions this
 *  way and the canvas centres on `anchor * panel.img.w`, which is what lets a
 *  jump land correctly at whatever scale that panel happens to be rendered —
 *  including a hi-res sheet whose panel scale is not RENDER_SCALE at all. Doing
 *  the division HERE (against the index's own recorded space) is what makes the
 *  page-1-vs-pages-2+ unit mismatch structurally impossible rather than a
 *  convention every caller has to remember. */
export function normalizedAnchor(index: SheetIndex, anchor: [number, number] | null | undefined): [number, number] | null {
  if (!anchor || !index.w || !index.h) return null;
  return [anchor[0] / index.w, anchor[1] / index.h];
}

/** Drop every page of one file from an index map.
 *
 *  MUST run whenever a file's BYTES change or the file goes away. store.addPdf
 *  keys IndexedDB on the file NAME, so re-adding a reissued A101.pdf overwrites
 *  the old bytes under the very same sheet key — an index entry that isn't
 *  dropped with them keeps answering with the superseded sheet's text, silently.
 *  Reissued sheets are the normal bid cycle here (#149/#161), not an edge case.
 *
 *  Closing a PDF has a second, louder failure if this is skipped: the stale
 *  entries stay searchable, so a hit can name a sheet that is no longer in the
 *  working set and the gallery renders a card for a sheet it cannot load.
 *
 *  Keys are snapshotted before deleting — mutating a Map while iterating its own
 *  live key view is the kind of thing that works until it doesn't. */
export function dropFileFromIndex(map: Map<string, SheetIndex>, file: string): number {
  let dropped = 0;
  for (const key of [...map.keys()]) {
    if (parseSheetKey(key).file === file) { map.delete(key); dropped++; }
  }
  return dropped;
}

/** Every code term on a sheet, split by kind — the "symbol Tier 1" tag index
 *  (docs/CLIENT_SIDE_OCR_RESEARCH.md §5). Falls out of the same tokens the
 *  search index already holds, so it costs a pass over `terms` and no new
 *  extraction. Sorted for stable UI. */
export function sheetCodes(index: SheetIndex): { tags: string[]; rooms: string[] } {
  const tags: string[] = [], rooms: string[] = [];
  for (const term in index.terms) {
    // ROOM first: a bare "101" is a room number, and TAG_RE would never see it
    // anyway, but SHEET_NO_RE-shaped codes like "A101" must not land in rooms.
    if (ROOM_RE.test(term)) rooms.push(term);
    else if (TAG_RE.test(term)) tags.push(term);
  }
  return { tags: tags.sort(), rooms: rooms.sort() };
}

/** Persisted shape: a plain array of SheetIndex, versioned so a future field
 *  change can be detected rather than silently mis-read. */
export const PLAN_INDEX_SCHEMA = "opentakeoff.plan_index.v1";
export interface PersistedPlanIndex {
  schema: string;
  entries: SheetIndex[];
}

/** Serialize a live index map for storage. */
export function serializePlanIndex(map: Map<string, SheetIndex>): PersistedPlanIndex {
  return { schema: PLAN_INDEX_SCHEMA, entries: [...map.values()] };
}

/** Rehydrate a persisted index, dropping anything that can't be trusted.
 *
 *  Sanitize on LOAD, not just on save — the `sanitizeTemplates` precedent. This
 *  record survives reloads and app versions, so a malformed entry from any past
 *  writer must degrade to "that sheet isn't indexed yet" (it simply gets re-read)
 *  rather than throwing inside hydrate and wedging the gallery.
 *
 *  `validFiles` is the CURRENT plan set's FILE names — not sheet keys, because a
 *  file's page count isn't known at load time (it's discovered by enumeration).
 *  Any entry whose file is absent is dropped, so a stored index can never
 *  resurrect a sheet the project no longer has — the same guarantee the live
 *  search gets by intersecting hits with the plan set.
 *  A wrong/absent schema drops everything, which costs one re-index and is the
 *  safe direction to fail. */
export function sanitizePlanIndex(raw: unknown, validFiles: Iterable<string>): Map<string, SheetIndex> {
  const out = new Map<string, SheetIndex>();
  const o = raw as PersistedPlanIndex | undefined;
  if (!o || typeof o !== "object" || o.schema !== PLAN_INDEX_SCHEMA || !Array.isArray(o.entries)) return out;
  const allow = new Set(validFiles);
  for (const e of o.entries) {
    if (!e || typeof e !== "object") continue;
    const key = typeof e.key === "string" ? e.key : "";
    if (!key || out.has(key) || !allow.has(parseSheetKey(key).file)) continue;
    if (!e.terms || typeof e.terms !== "object" || Array.isArray(e.terms)) continue;
    const terms: Record<string, number[]> = {};
    for (const term in e.terms) {
      const a = (e.terms as Record<string, unknown>)[term];
      // anchors are flat [x,y,…] pairs of finite numbers; anything else is dropped
      if (!Array.isArray(a) || a.length % 2 !== 0) continue;
      if (!a.every((n) => typeof n === "number" && Number.isFinite(n))) continue;
      terms[term] = a as number[];
    }
    out.set(key, {
      key,
      source: e.source === "ocr" ? "ocr" : "text",
      builtAt: typeof e.builtAt === "number" && Number.isFinite(e.builtAt) ? e.builtAt : 0,
      terms,
      tokenCount: typeof e.tokenCount === "number" && Number.isFinite(e.tokenCount) ? e.tokenCount : 0,
      w: typeof e.w === "number" && Number.isFinite(e.w) ? e.w : 0,
      h: typeof e.h === "number" && Number.isFinite(e.h) ? e.h : 0,
    });
  }
  return out;
}
