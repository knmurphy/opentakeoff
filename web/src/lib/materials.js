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
// plain object with a non-empty string `id` (entries without one are dropped
// — lib_id links and row keys both match on it). Field defaulting stays the
// canvas's job (libFields / the `||` fallbacks in the tab). Unknown item
// fields pass through (the scale_source precedent: stripping a future field
// on load would persist the loss on the next library save).

const isPlainObject = (v) => !!v && typeof v === "object" && !Array.isArray(v);

export function sanitizeMaterialLibrary(raw) {
  if (!Array.isArray(raw)) return [];
  return raw.filter((m) => isPlainObject(m) && typeof m.id === "string" && m.id);
}
