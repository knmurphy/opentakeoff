// The reference plugin's ONE real shape mutation, factored out of the JSX so it
// is unit-testable without a React renderer. It builds a `label` command — a
// valid PROVENANCE_POLICY type (shapeCommands.js: "label" → documented non-edit)
// — and dispatches it through the ctx command chokepoint, which the host routes
// to applyShapeCommand (real undo/redo + provenance, NOT a raw setShapes).
//
// The command shape is exactly what applyShapeCommand's `label` case consumes:
// { type: "label", ids: string[], value: string }. Passing an empty `value`
// clears the label (assignShapeLabel semantics); this helper only labels, so it
// requires a non-empty tag and at least one target id.

/**
 * Dispatch a label command tagging the given shape ids. Returns the command it
 * dispatched (or null when there is nothing to label) so callers/tests can
 * assert what was sent.
 *
 * @param {{ dispatchShape: (cmd: object, opts?: object) => void }} commands
 * @param {string[]} ids
 * @param {string} tag
 * @returns {{ type: "label", ids: string[], value: string } | null}
 */
export function dispatchNoteLabel(commands, ids, tag) {
  const value = typeof tag === "string" ? tag.trim() : "";
  if (!value || !Array.isArray(ids) || ids.length === 0) return null;
  const cmd = { type: "label", ids: [...ids], value };
  commands.dispatchShape(cmd);
  return cmd;
}
