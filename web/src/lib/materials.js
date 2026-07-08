// Material library (browser-global `material_library` meta record, #47).
// Like the condition-template record, it's shared across every project in
// the browser, so a single corrupt item would crash the canvas for ALL
// projects at once (matLibById dereferences `m.id` on every entry, and the
// Materials tab keys its rows on it). This sanitizer is the load gate (the
// sanitizeTemplates precedent): store.loadMaterialLibrary() routes through it
// so nothing malformed ever reaches the canvas.
//
// The contract — deliberately minimal ("safe to dereference and key on", not
// a re-implementation of the canvas's defaulting): every returned item is a
// plain object with a non-empty string `id`, unique within the list (entries
// without one, or later duplicates, are dropped — first-wins, the
// sanitizeConditionColumns precedent — since matLibById, the Materials tab's
// row keys, and updateLibMaterial all match on `id`, and a duplicate breaks
// all three). Field defaulting stays the canvas's job (libFields / the `||`
// fallbacks in the tab). Unknown item fields pass through (the scale_source
// precedent: stripping a future field on load would persist the loss on the
// next library save).

const isPlainObject = (v) => !!v && typeof v === "object" && !Array.isArray(v);

export function sanitizeMaterialLibrary(raw) {
  if (!Array.isArray(raw)) return [];
  const seenIds = new Set();
  return raw.filter((m) => {
    if (!(isPlainObject(m) && typeof m.id === "string" && m.id)) return false;
    if (seenIds.has(m.id)) return false;
    seenIds.add(m.id);
    return true;
  });
}
