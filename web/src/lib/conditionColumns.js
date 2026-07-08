// Custom condition columns (issue #33) — a project-level vocabulary persisted
// as the `condition_columns` payload key: [{ id: "col-…", name, values: [string] }].
// Per-condition assignment lives on c.attrs = { [colId]: value }, keyed by
// column ID so renames never orphan assignments; unassigned = key absent.
// Pure helpers here so hydrate defensiveness and the rename-rewrite are testable.

// Defensive hydrate for condition_columns: non-array → [], items must carry a
// non-empty string id and a string name, values string-filtered — the same
// hazard hydrate string-filters client_info for (a corrupted record must not
// put a non-string where a React child or <option> renders). Values also drop
// empties/whitespace (an empty value collides with the selects' Unassigned
// option, value="") and dedupe, and later duplicate column ids are dropped —
// values and ids key React options/chips, so duplicates break rendering.
// Unknown item fields pass through (the scale_source precedent: stripping a
// future field on load would persist the loss on the next autosave).
export function sanitizeConditionColumns(raw) {
  if (!Array.isArray(raw)) return [];
  const seenIds = new Set();
  return raw
    .filter((c) => {
      if (!(c && typeof c === "object" && !Array.isArray(c) && typeof c.id === "string" && c.id && typeof c.name === "string")) return false;
      if (seenIds.has(c.id)) return false;
      seenIds.add(c.id);
      return true;
    })
    .map((c) => ({ ...c, values: [...new Set((Array.isArray(c.values) ? c.values : []).filter((v) => typeof v === "string" && v.trim()))] }));
}

// Rewrite assignments when a vocabulary value is renamed — typo-fixing is the
// common edit, and remove+re-add would strand every assigned condition on a
// "(removed)" value. Only exact matches on THIS column move; other columns and
// untouched conditions keep their object identity.
export function renameColumnValue(conditions, colId, oldV, newV) {
  return conditions.map((c) => (c.attrs?.[colId] === oldV ? { ...c, attrs: { ...c.attrs, [colId]: newV } } : c));
}
