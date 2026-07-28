// The reference plugin's ONE real mutation, at the PURE level (no React
// renderer). Two things are proven:
//   (1) the plugin helper forwards to commands.dispatchShape with a VALID label
//       command — { type: "label", ids, value }; and
//   (2) that exact produced command, fed into the REAL applyShapeCommand
//       (shapeCommands.js — the chokepoint the host routes dispatchShape to),
//       lands the label AND yields an inverse that round-trips (undo/redo).
// Half (2) is what goes red if the command shape ever drifts from what
// applyShapeCommand consumes — a mock-only forwarding assertion would not.
import { test } from "node:test";
import assert from "node:assert/strict";
import { dispatchNoteLabel } from "../src/features/takeoff-notes/labelCommand.js";
import { applyShapeCommand, PROVENANCE_POLICY } from "../src/lib/shapeCommands.js";

test("label is a valid PROVENANCE_POLICY command type", () => {
  assert.ok("label" in PROVENANCE_POLICY, "'label' must be an applyShapeCommand type");
});

test("dispatchNoteLabel forwards a valid label command to commands.dispatchShape", () => {
  const calls: Array<[unknown, unknown]> = [];
  const commands = { dispatchShape: (cmd: object, opts?: object) => { calls.push([cmd, opts]); } };

  const cmd = dispatchNoteLabel(commands, ["s1"], "  Note A  ");

  assert.deepEqual(cmd, { type: "label", ids: ["s1"], value: "Note A" }, "trims + builds the label command");
  assert.equal(calls.length, 1, "dispatched exactly once");
  assert.deepEqual(calls[0][0], cmd, "forwarded the produced command");
  assert.equal(calls[0][1], undefined, "no dispatch opts");
});

test("the produced command drives the REAL applyShapeCommand and round-trips", () => {
  type Shape = Record<string, unknown>;
  const shapes: Shape[] = [
    { id: "s1", condition_id: "c1" },
    { id: "s2", condition_id: "c1" },
  ];
  let dispatched: object | null = null;
  const commands = { dispatchShape: (cmd: object) => { dispatched = cmd; } };

  const cmd = dispatchNoteLabel(commands, ["s1"], "Kitchen");
  assert.deepEqual(cmd, dispatched);
  assert.ok(dispatched, "a command was dispatched");

  const res = applyShapeCommand(shapes, dispatched);
  const byId = (id: string): Shape =>
    (res.shapes as Shape[]).find((s) => s.id === id) as Shape;
  assert.equal(byId("s1").label, "Kitchen", "label lands on the target");
  assert.equal("label" in byId("s2"), false, "other shapes untouched");
  assert.ok(res.inverse, "an inverse is recorded (undoable)");

  // Undo: applying the inverse restores the pre-label array exactly.
  const undone = applyShapeCommand(res.shapes, res.inverse);
  assert.deepEqual(undone.shapes, shapes, "inverse restores the original shapes (undo is clean)");
});

test("dispatchNoteLabel is a no-op with no target or empty tag (nothing dispatched)", () => {
  let count = 0;
  const commands = { dispatchShape: () => { count += 1; } };

  assert.equal(dispatchNoteLabel(commands, [], "note"), null, "no ids → null");
  assert.equal(dispatchNoteLabel(commands, ["s1"], "   "), null, "blank tag → null");
  assert.equal(count, 0, "never dispatched when there is nothing to label");
});
