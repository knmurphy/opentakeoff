// The split-view data model + persistence codec. A "split" is the existing
// interactive stage (primary) beside ONE read-only reference pane.
// Persisted additively (omit-when-absent) so non-split projects round-trip
// byte-identically, matching buildPayload's sheet_group/sheet_tabs convention.

export type Orientation = "v" | "h"; // v = left/right, h = top/bottom
export interface SplitView {
  orientation: Orientation;
  ratio: number;  // primary pane's fraction of the split axis
  refKey: string; // sheetKey framed in the reference pane
}

export const MIN_RATIO = 0.2;
export const MAX_RATIO = 0.8;
// Cap on total live sheets across both panes (primary group members +
// reference members). Guards the tile-pool/LRU budget; tuned in Task 8.
export const SPLIT_MAX_TOTAL_SHEETS = 6;

export const clampRatio = (r: number): number =>
  Math.min(MAX_RATIO, Math.max(MIN_RATIO, r));

export const serializeSplitView = (sv: SplitView | null): object | null =>
  sv ? { orientation: sv.orientation, ratio: sv.ratio, refKey: sv.refKey } : null;

export const normalizeSplitView = (raw: unknown): SplitView | null => {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (r.orientation !== "v" && r.orientation !== "h") return null;
  if (typeof r.refKey !== "string" || !r.refKey) return null;
  if (typeof r.ratio !== "number" || Number.isNaN(r.ratio)) return null;
  return { orientation: r.orientation, ratio: clampRatio(r.ratio), refKey: r.refKey };
};
