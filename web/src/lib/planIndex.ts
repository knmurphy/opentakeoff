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
// their keep. web/package.json runs on 7 runtime deps; an inverted Map is not
// worth an eighth. See docs/CLIENT_SIDE_OCR_RESEARCH.md §6.
//
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
  /** term → flat [x0,y0, x1,y1, …] anchors in image px, capped at MAX_ANCHORS. */
  terms: Record<string, number[]>;
  /** distinct terms seen, INCLUDING ones dropped as unsearchable — the honest
   *  denominator for "did this sheet have text at all". */
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
): SheetIndex {
  const terms: Record<string, number[]> = {};
  let tokenCount = 0;
  for (const it of items || []) {
    for (const raw of splitRun(it.str)) {
      const term = normalizeTerm(raw);
      if (!term) continue;
      tokenCount++;
      if (!isSearchable(term)) continue;
      const anchors = (terms[term] ??= []);
      if (anchors.length < MAX_ANCHORS * 2) anchors.push(it.x, it.y);
    }
  }
  return { key, source, builtAt, terms, tokenCount };
}

/** One sheet that matched, with what it matched on and where to jump. */
export interface SheetHit {
  key: string;
  source: IndexSource;
  score: number;
  /** the index terms that satisfied the query, best first */
  matched: string[];
  /** first anchor of the best-matching term, image px — or null if unanchored */
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
  return hits.sort((a, b) => b.score - a.score || a.key.localeCompare(b.key));
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
