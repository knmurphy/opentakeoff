// Custom condition columns (issue #33) — the pure halves of the canvas feature.
// The invariants under test:
//   - a well-formed condition_columns array survives the save → JSON → hydrate
//     round-trip unchanged (sanitizeConditionColumns is hydrate's gate);
//   - hydrate defensiveness: non-array → [], items without a non-empty string
//     id or a string name dropped, non-string values filtered, unknown item
//     fields preserved (the scale_source precedent — stripping a future field
//     on load would persist the loss on the next autosave);
//   - buildPayload omits the key when empty (client_info precedent), so a
//     project that never defines a column produces byte-identical payloads;
//   - renameColumnValue rewrites exact matches on that column only — other
//     columns, other values, and unassigned conditions keep object identity.
import { test } from "node:test";
import assert from "node:assert/strict";
import { sanitizeConditionColumns, renameColumnValue } from "../src/lib/conditionColumns.js";

const cols = () => [
  { id: "col-a", name: "CSI Division", values: ["09 65 00", "09 68 00"] },
  { id: "col-b", name: "", values: [] },   // unnamed + empty vocabulary are legal states
];

// ── sanitizeConditionColumns ─────────────────────────────────────────────────

test("round-trip: a saved condition_columns array hydrates unchanged", () => {
  const saved = cols();
  // autosave path: buildPayload embeds the array → store JSON-serializes →
  // hydrate gates it through the sanitizer. attrs need no counterpart: they
  // ride each condition wholesale (save/load never enumerate condition fields).
  const hydrated = sanitizeConditionColumns(JSON.parse(JSON.stringify(saved)));
  assert.deepEqual(hydrated, saved);
});

test("non-array payloads hydrate to []", () => {
  for (const raw of [undefined, null, 42, "col", {}, { id: "col-a" }]) {
    assert.deepEqual(sanitizeConditionColumns(raw), [], String(raw));
  }
});

test("malformed items are dropped: id/name must be strings, id non-empty", () => {
  const raw = [
    ...cols(),
    null,                                        // not an object
    "col-c",                                     // not an object
    ["col-d"],                                   // array is not a column
    { name: "no id", values: [] },               // missing id
    { id: 7, name: "numeric id", values: [] },   // non-string id
    { id: "", name: "empty id", values: [] },    // empty id can't key attrs
    { id: "col-e", values: [] },                 // missing name
    { id: "col-f", name: null, values: [] },     // non-string name
  ];
  assert.deepEqual(sanitizeConditionColumns(raw), cols());
});

test("values are string-filtered; non-array values become []", () => {
  const [a] = sanitizeConditionColumns([{ id: "col-a", name: "N", values: ["ok", 3, null, { v: "x" }, "", "also ok"] }]);
  assert.deepEqual(a.values, ["ok", "", "also ok"]);   // "" is a string — the UI's trim/dupe guard, not hydrate, keeps it out
  const [b] = sanitizeConditionColumns([{ id: "col-b", name: "N", values: "not-an-array" }]);
  assert.deepEqual(b.values, []);
});

test("unknown item fields pass through the round-trip", () => {
  const [c] = sanitizeConditionColumns([{ id: "col-a", name: "N", values: ["v"], future_field: "kept" }]);
  assert.equal((c as any).future_field, "kept");
});

// ── omit-when-empty (buildPayload behavior) ──────────────────────────────────

test("payload omits condition_columns when empty — byte-stable for older projects", () => {
  // buildPayload's exact spread: `...(conditionColumns.length ? { condition_columns: conditionColumns } : {})`.
  // Empty → the key never appears, so a project that predates custom columns
  // serializes byte-identically to before this feature (client_info precedent).
  const payload = (conditionColumns: any[]) => ({ conditions: [], ...(conditionColumns.length ? { condition_columns: conditionColumns } : {}), shapes: [] });
  assert.equal(JSON.stringify(payload([])), JSON.stringify({ conditions: [], shapes: [] }));
  assert.ok("condition_columns" in payload(cols()));
  // and hydrate closes the loop: the absent key sets state back to []
  assert.deepEqual(sanitizeConditionColumns((payload([]) as any).condition_columns), []);
});

// ── renameColumnValue ────────────────────────────────────────────────────────

const conds = () => [
  { id: "c1", finish_tag: "CPT-1", attrs: { "col-a": "09 68 00" } },
  { id: "c2", finish_tag: "LVT-1", attrs: { "col-a": "09 65 00", "col-b": "09 68 00" } },   // same STRING under another column
  { id: "c3", finish_tag: "CT-1" },                                                         // no attrs at all
];

test("rename rewrites matching assignments on that column only", () => {
  const out = renameColumnValue(conds(), "col-a", "09 68 00", "09 68 13");
  assert.equal(out[0].attrs!["col-a"], "09 68 13");        // matched → rewritten
  assert.equal(out[1].attrs!["col-a"], "09 65 00");        // other value untouched
  assert.equal(out[1].attrs!["col-b"], "09 68 00");        // same string under another column untouched
  assert.equal(out[0].finish_tag, "CPT-1");                // rest of the condition intact
});

test("rename leaves non-matching conditions with their object identity", () => {
  const input = conds();
  const out = renameColumnValue(input, "col-a", "09 68 00", "09 68 13");
  assert.notEqual(out[0], input[0]);   // rewritten → new object (React re-render)
  assert.equal(out[1], input[1]);      // untouched → same reference
  assert.equal(out[2], input[2]);      // attrs-less condition untouched (?. guard)
});
