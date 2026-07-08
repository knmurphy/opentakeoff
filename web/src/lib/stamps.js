// Stamp library (browser-global `stamp_library` meta record, #40).
//
// A stamp is a reusable annotation — a named group of markup-like primitives
// with local coordinates — that drops onto any sheet with a click (the
// tool-chest pattern estimators know from Bluebeam). Unlike conditions and
// markups (per-project), the stamp library is the app's FIRST cross-project
// asset: it lives under its own key in the keyPath-less meta store, shared
// across every project in the browser (the condition-template / material-
// library precedent, store.loadStampLibrary). Export/import as JSON so a crew
// shares one standard set.
//
// The model:
//   StampElement = a markup primitive in a LOCAL frame — coords are OFFSETS
//     (fractions of sheet width/height) from the stamp's anchor (the click
//     point), so a stamp is scale/position independent until placed:
//       text    { type:"text",    at:[dx,dy], text, prompt? }
//       arrow   { type:"arrow",   from:[dx,dy], to:[dx,dy], text? }
//       bubble  { type:"bubble",  at:[dx,dy], r, text, prompt? }
//       callout { type:"callout", at:[dx,dy], target:[dx,dy], text, prompt? }
//       cloud   { type:"cloud",   rect:[[dx,dy],[dx,dy]], text }
//       highlight { type:"highlight", rect:[[dx,dy],[dx,dy]], text }
//     plus optional color / line_style / weight on any element.
//   Stamp        = { id, name, elements:[StampElement] }
//   StampSet     = { id, name, stampIds:[...] }
//   StampLibrary = { stamps:[...], sets:[...] }
//
// Placement (instantiateStamp) translates every element's offsets by the click
// point and returns plain markup objects (no id/sheet_id) — the canvas wraps
// each with addMarkup, so placed instances are NORMAL, editable markups that
// burn into the marked set like any other. `arrow` and `bubble` are new markup
// primitives added alongside the existing cloud/callout/text/highlight.
//
// Like the template/material libraries, this sanitizer is the load gate: the
// record is browser-global, so one corrupt item would otherwise break the
// palette (and its seeding) for EVERY project at once. The contract is
// deliberately minimal ("safe to dereference, key on, and instantiate") —
// element-level defaulting stays instantiateStamp's job, and unknown fields
// pass through (the scale_source precedent) so a valid library survives the
// save → load round-trip unchanged.

const isPlainObject = (v) => !!v && typeof v === "object" && !Array.isArray(v);
const isPair = (p) => Array.isArray(p) && p.length === 2 && typeof p[0] === "number" && typeof p[1] === "number" && Number.isFinite(p[0]) && Number.isFinite(p[1]);
const clone = (v) => JSON.parse(JSON.stringify(v));

export function sanitizeStampLibrary(raw) {
  const lib = isPlainObject(raw) ? raw : {};
  const seenStamp = new Set();
  const stamps = (Array.isArray(lib.stamps) ? lib.stamps : [])
    .filter((s) => {
      if (!(isPlainObject(s) && typeof s.id === "string" && s.id && typeof s.name === "string" && s.name.trim())) return false;
      if (seenStamp.has(s.id)) return false;   // first-wins dedup (matLib precedent) — the palette keys rows on id
      seenStamp.add(s.id);
      return true;
    })
    .map((s) => ({ ...s, elements: (Array.isArray(s.elements) ? s.elements : []).filter(isPlainObject) }));
  const seenSet = new Set();
  const sets = (Array.isArray(lib.sets) ? lib.sets : [])
    .filter((set) => {
      if (!(isPlainObject(set) && typeof set.id === "string" && set.id)) return false;
      if (seenSet.has(set.id)) return false;
      seenSet.add(set.id);
      return true;
    })
    .map((set) => ({ ...set, name: typeof set.name === "string" ? set.name : "", stampIds: (Array.isArray(set.stampIds) ? set.stampIds : []).filter((id) => typeof id === "string" && id) }));
  return { stamps, sets };
}

// Instantiate a stamp at a click point (normalized sheet coords [cx,cy]).
// Returns plain markup objects (type + resolved coords + carried appearance +
// text; an `_prompt` flag on the element the caller should open a text editor
// for). Malformed elements — missing/invalid coords — are dropped, so a
// half-broken stamp still places its good elements instead of minting garbage
// markups. The caller (placeStamp) mints ids and sheet_id via addMarkup.
export function instantiateStamp(stamp, [cx, cy]) {
  const off = (p) => [cx + p[0], cy + p[1]];
  const out = [];
  for (const el of stamp?.elements || []) {
    if (!isPlainObject(el)) continue;
    const base = {};
    for (const k of ["color", "line_style", "weight"]) if (el[k] != null) base[k] = el[k];
    const text = typeof el.text === "string" ? el.text : "";
    const promptFlag = el.prompt ? { _prompt: true } : {};
    if (el.type === "arrow") {
      if (!isPair(el.from) || !isPair(el.to)) continue;
      out.push({ ...base, type: "arrow", from: off(el.from), to: off(el.to), text, ...promptFlag });
    } else if (el.type === "bubble") {
      if (!isPair(el.at)) continue;
      out.push({ ...base, type: "bubble", at: off(el.at), r: Number(el.r) > 0 ? Number(el.r) : 0.02, text, ...promptFlag });
    } else if (el.type === "callout") {
      if (!isPair(el.at) || !isPair(el.target)) continue;
      out.push({ ...base, type: "callout", at: off(el.at), target: off(el.target), text, ...promptFlag });
    } else if (el.type === "cloud" || el.type === "highlight") {
      if (!Array.isArray(el.rect) || !isPair(el.rect[0]) || !isPair(el.rect[1])) continue;
      out.push({ ...base, type: el.type, rect: [off(el.rect[0]), off(el.rect[1])], text });
    } else {
      // default/text
      if (!isPair(el.at)) continue;
      out.push({ ...base, type: "text", at: off(el.at), text, ...promptFlag });
    }
  }
  return out;
}

// Capture a placed markup as a single-element stamp element — the inverse of
// instantiateStamp for one element: re-express its coords as OFFSETS from the
// markup's own anchor so the saved stamp is position independent. Returns null
// for a markup with no usable geometry. Appearance (color/line_style/weight)
// and text carry through; `r` carries for bubbles.
export function markupToStampElement(m) {
  if (!isPlainObject(m)) return null;
  const carry = {};
  for (const k of ["color", "line_style", "weight"]) if (m[k] != null && m[k] !== "") carry[k] = m[k];
  const text = typeof m.text === "string" ? m.text : "";
  const sub = (p, a) => [p[0] - a[0], p[1] - a[1]];
  if (m.type === "arrow" && isPair(m.from) && isPair(m.to)) {
    const a = [(m.from[0] + m.to[0]) / 2, (m.from[1] + m.to[1]) / 2];
    return { ...carry, type: "arrow", from: sub(m.from, a), to: sub(m.to, a), text };
  }
  if (m.type === "bubble" && isPair(m.at)) {
    return { ...carry, type: "bubble", at: [0, 0], r: Number(m.r) > 0 ? Number(m.r) : 0.02, text };
  }
  if (m.type === "callout" && isPair(m.at) && isPair(m.target)) {
    return { ...carry, type: "callout", at: sub(m.at, m.at), target: sub(m.target, m.at), text };
  }
  if ((m.type === "cloud" || m.type === "highlight") && Array.isArray(m.rect) && isPair(m.rect[0]) && isPair(m.rect[1])) {
    const a = [(m.rect[0][0] + m.rect[1][0]) / 2, (m.rect[0][1] + m.rect[1][1]) / 2];
    return { ...carry, type: m.type, rect: [sub(m.rect[0], a), sub(m.rect[1], a)], text };
  }
  if (m.type === "text" && isPair(m.at)) {
    return { ...carry, type: "text", at: [0, 0], text };
  }
  return null;
}

// Starter flooring shop-drawing stamps, seeded on an empty library (the
// FLOORING_DEFAULTS precedent for conditions). Offsets are fractions of sheet
// width/height; ids are stable so re-seeding is idempotent. `prompt:true`
// elements open a text editor on placement (bubble numbers). Approval stamps
// are compound (a highlight box carrying the stamp text) — the model supports
// multi-element stamps; the palette lists each as one placeable entry.
export const DEFAULT_STAMPS = [
  { id: "stmp-north", name: "North arrow", elements: [
    { type: "arrow", from: [0, 0.045], to: [0, -0.045], color: "#0e1a2e", weight: 1.5 },
    { type: "text", at: [-0.006, -0.055], text: "N", color: "#0e1a2e" },
  ] },
  { id: "stmp-direction", name: "Plank / tile direction", elements: [
    { type: "arrow", from: [-0.05, 0], to: [0.05, 0], color: "#1f3fc7", weight: 1.5 },
  ] },
  { id: "stmp-seam", name: "Seam direction", elements: [
    { type: "arrow", from: [-0.05, 0], to: [0.05, 0], color: "#b03a26", line_style: "dashed" },
  ] },
  { id: "stmp-detail", name: "Detail bubble", elements: [
    { type: "bubble", at: [0, 0], r: 0.022, text: "", prompt: true, color: "#1f3fc7" },
  ] },
  { id: "stmp-keynote", name: "Keyed note", elements: [
    { type: "bubble", at: [0, 0], r: 0.02, text: "", prompt: true, color: "#c47a10" },
  ] },
  { id: "stmp-origin", name: "Pattern origin", elements: [
    { type: "bubble", at: [0, 0], r: 0.018, text: "PO", color: "#0d9488" },
  ] },
  { id: "stmp-for-construction", name: "FOR CONSTRUCTION", elements: [
    { type: "highlight", rect: [[-0.065, -0.018], [0.065, 0.018]], text: "FOR CONSTRUCTION", color: "#0d9488" },
  ] },
  { id: "stmp-as-built", name: "AS-BUILT", elements: [
    { type: "highlight", rect: [[-0.045, -0.018], [0.045, 0.018]], text: "AS-BUILT", color: "#9333ea" },
  ] },
  { id: "stmp-approved", name: "APPROVED", elements: [
    { type: "highlight", rect: [[-0.045, -0.018], [0.045, 0.018]], text: "APPROVED", color: "#2f7d54" },
  ] },
];
export const DEFAULT_STAMP_SETS = [
  { id: "set-flooring", name: "Flooring shop drawings", stampIds: DEFAULT_STAMPS.map((s) => s.id) },
];

// Fresh-library seeding: a library with stamps is left alone; only a truly
// empty one gets the flooring defaults (the seedConditions precedent). Returns
// a deep clone so the module constants can never be mutated by a caller edit.
export function seedStampLibrary(lib) {
  const clean = sanitizeStampLibrary(lib);
  if (clean.stamps.length) return clean;
  return { stamps: clone(DEFAULT_STAMPS), sets: clone(DEFAULT_STAMP_SETS) };
}
