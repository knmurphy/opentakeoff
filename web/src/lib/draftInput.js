// Pure decision logic for draft-buffered numeric inputs (GroutParamInput and
// the Materials tab's per field). The components keep the RAW string in local
// state while the field is being edited — clamping/coercing inside onChange
// made the joint field untypeable (every keystroke through "0." snapped to
// the 0.03125 min) and wiped the leading "0" of decimals — and consult these
// two helpers for what, if anything, to commit. Extracted so the rules are
// testable without a DOM.

// While typing: commit the draft only when it parses to a fully valid,
// in-range positive number; otherwise commit NOTHING (null) — the caller
// keeps the last good committed value while the draft stays on screen.
export function draftCommitValue(text, min = 0, max) {
  const v = parseFloat(text);
  return Number.isFinite(v) && v > 0 && v >= min && (max == null || v <= max) ? v : null;
}

// On blur: a positive number clamps into [min, max] and commits; an
// empty/invalid draft is ABANDONED (null — the last good committed value
// redisplays). Never returns an out-of-range or non-positive value, so a
// committed grout param can never be invalid.
export function blurCommitValue(text, min = 0, max) {
  const v = parseFloat(text ?? "");
  return Number.isFinite(v) && v > 0 ? Math.min(max ?? Infinity, Math.max(min, v)) : null;
}
