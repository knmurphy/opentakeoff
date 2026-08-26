// The split-view data model + persistence codec. A "split" is the existing
// interactive stage (primary) beside ONE read-only reference pane.
// Persisted additively (omit-when-absent) so non-split projects round-trip
// byte-identically, matching buildPayload's sheet_group/sheet_tabs convention.

export type Orientation = "v" | "h"; // v = left/right, h = top/bottom
export interface SplitView {
  orientation: Orientation;
  ratio: number;  // primary pane's fraction of the split axis
  refKey: string; // sheetKey currently FRAMED in the reference pane
  // The reference pane's tab bar (Task 7): every sheetKey dropped onto the
  // reference pane, `refKey` included. Optional on construction (a caller
  // that only cares about `refKey` can omit it) but the codec below always
  // backfills a concrete array on the way out to persistence AND on the way
  // back in — so anything that reads `sv.refSet` off a normalized object
  // never has to fall back to `[sv.refKey]` itself.
  refSet?: string[];
}

export const MIN_RATIO = 0.2;
export const MAX_RATIO = 0.8;
// Cap on total live sheets across both panes (primary group members +
// reference members). Guards the tile-pool/LRU budget; tuned in Task 8.
export const SPLIT_MAX_TOTAL_SHEETS = 6;

export const clampRatio = (r: number): number =>
  Math.min(MAX_RATIO, Math.max(MIN_RATIO, r));

export const serializeSplitView = (sv: SplitView | null): object | null =>
  sv
    ? {
        orientation: sv.orientation,
        ratio: sv.ratio,
        refKey: sv.refKey,
        // Backfill here too: an in-memory SplitView built before every
        // creation site set refSet (or the DEV __otSetSplit hook) must still
        // persist a coherent reference set, not an absent/malformed one.
        refSet: sv.refSet && sv.refSet.length ? sv.refSet : [sv.refKey],
      }
    : null;

export const normalizeSplitView = (raw: unknown): SplitView | null => {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (r.orientation !== "v" && r.orientation !== "h") return null;
  if (typeof r.refKey !== "string" || !r.refKey) return null;
  if (typeof r.ratio !== "number" || Number.isNaN(r.ratio)) return null;
  // refSet always contains refKey (the framed sheet is, definitionally, a
  // member of the reference pane's set) plus every other validated entry,
  // deduped, order preserved. A pre-Task-7 payload (no refSet field at all)
  // or one with non-string entries backfills to just [refKey] — same
  // "additive, omit/malformed-tolerant" contract the rest of this codec uses.
  const rawSet = Array.isArray(r.refSet) ? r.refSet.filter((k): k is string => typeof k === "string" && !!k) : [];
  const refSet = [...new Set([r.refKey, ...rawSet])];
  return { orientation: r.orientation, ratio: clampRatio(r.ratio), refKey: r.refKey, refSet };
};
