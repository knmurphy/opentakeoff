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
// all three). Field defaulting stays libFields' / the tab's `||` fallbacks'
// job. Unknown item fields pass through (the scale_source
// precedent: stripping a future field on load would persist the loss on the
// next library save).

import { groutParamsEqual, groutNote, materialKind } from "./coverage.js";

const isPlainObject = (v) => !!v && typeof v === "object" && !Array.isArray(v);

// ── the library-link seam (#47 copy-on-attach + the grout calculator) ───────
// Every copy between a condition material line and a library entry flows
// through libFields: attach, promote, per-field revert, and push-to-linked all
// build their copies from it, and matFieldOverridden compares against it. The
// grout tile geometry (a nested object) and the material kind ride along —
// dropping them here is exactly the desync the adversarial review found
// (attached mosaics rendering 12×24 defaults, pushes leaving stale geometry).
// grout is DEEP-COPIED at every copy point: a shared reference would alias one
// geometry object across the library and every linked line.
export const libFields = (lm) => ({
  name: lm.name || "", unit: lm.unit || "", per: lm.per || 0, basis: lm.basis || "area",
  round: lm.round !== false, note: lm.note || "",
  ...(lm.kind ? { kind: lm.kind } : {}),
  ...(lm.grout ? { grout: { ...lm.grout } } : {}),
});

// overridden = this line's field differs from its linked library entry
// (the amber tint + per-field ↺ in MaterialsEditor). "grout" compares the five
// geometry params structurally — never by reference — so geometry drift on a
// linked line ambers like any other override.
export const matFieldOverridden = (m, lm, f) => {
  if (!lm) return false;
  const L = libFields(lm);
  if (f === "per") return (Number(m.per) || 0) !== L.per;
  if (f === "round") return (m.round !== false) !== L.round;
  if (f === "basis") return (m.basis || "area") !== L.basis;   // absent basis means "area" everywhere else — don't flag it
  if (f === "grout") return !groutParamsEqual(m.grout, L.grout);
  return String(m[f] || "") !== String(L[f] || "");
};

// per + note on a grout line are DERIVED from its tile geometry, so the three
// fields must move together or the row contradicts its own calculator:
// · push replaces per/note/grout as a unit, and a library entry WITHOUT
//   geometry clears the line's — stale geometry would silently overwrite the
//   pushed rate on the next calculator keystroke;
// · reverting per, note, or the geometry row on a grout line restores all
//   three to the library values (a lone reverted per under an edited-geometry
//   note would print false provenance in the Report).
export const libPushPatch = (m, lm) => {
  const next = { ...m, ...libFields(lm) };
  if (!lm.grout) delete next.grout;
  return next;
};
export const libRevertPatch = (m, lm, f) => {
  const L = libFields(lm);
  if ((f === "per" || f === "note" || f === "grout") && (m.grout || lm.grout)) {
    return { per: L.per, note: L.note, grout: L.grout };   // L.grout is already a fresh copy (or undefined → clears the line's)
  }
  return { [f]: L[f] };
};

// NAME edits re-classify a geometry-less material. An explicit `kind` rides
// through the library seam (promote/attach/push carry it), but without tile
// geometry it's only a cached classification of the OLD name — keeping it
// would pin an attached "Adhesive" renamed "Thinset mortar" to adhesive
// presets forever (pre-seam behavior re-classified from the name). So when
// the name-regex classification of the new name disagrees with the stored
// kind, the kind is dropped and the name rules again. With geometry present,
// kind:"grout" is load-bearing (it gates the calculator whatever the line is
// called) and stays.
export const renameReclassified = (m) => {
  if (!m.kind || m.grout) return m;
  if (materialKind({ name: m.name }) === m.kind) return m;
  const { kind: _k, ...rest } = m;
  return rest;
};

// Condition-line edit (MaterialsEditor → updateMaterial): a plain merge, plus
// the rename re-classification above when the patch touches the name.
export const matEditPatch = (m, patch) => {
  const next = { ...m, ...patch };
  return "name" in patch ? renameReclassified(next) : next;
};

// Library-row edit (Materials tab). The tab has no grout calculator, so a
// hand edit that CHANGES per or note on an entry carrying tile geometry
// DETACHES the geometry — otherwise the entry would push/attach a grout
// object that contradicts its own per/note. Change-aware: committing a value
// equal to the current one (a select-all-retype of the same rate) is not a
// contradiction and must not detach. When per detaches the geometry and the
// entry's note is still the geometry-derived one, the note goes too — a
// derived note describing discarded geometry is false provenance in the
// Report and every export. A note the user typed themselves (patch.note)
// always wins.
export const libEntryPatch = (lm, patch) => {
  const next = { ...lm, ...patch, ...(patch.grout ? { grout: { ...patch.grout } } : {}) };
  if (next.grout && !("grout" in patch)) {
    const perChanged = "per" in patch && (Number(patch.per) || 0) !== (Number(lm.per) || 0);
    const noteChanged = "note" in patch && String(patch.note || "") !== String(lm.note || "");
    if (perChanged || noteChanged) {
      if (!("note" in patch) && String(next.note || "") === groutNote(next.grout)) next.note = "";
      delete next.grout;
    }
  }
  return "name" in patch ? renameReclassified(next) : next;
};

// Template/seed material → live condition line. The seed's grout object (CT-1
// carries { ...GROUT_DEFAULTS } built once at module load) must not be shared
// by reference into live state — deep-copy it per instantiation.
export const instantiateMaterial = (m, id) => ({
  round: true, ...m,
  ...(m.grout ? { grout: { ...m.grout } } : {}),
  id,
});

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
