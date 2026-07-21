// Agent tool registry (lib/agentTools.js) — the invariants:
//   - every tool declares a well-formed schema and validateToolArgs enforces it;
//   - an unknown tool or bad args is an { error } RESULT, never a throw;
//   - propose_shapes whitelists evidence (junk keys dropped, strings truncated)
//     and rejects uncited/unmeasurable shapes;
//   - one_click PROBES: it returns the ring and never stages/commits anything;
//   - the scale gate refuses real-world-unit work on an uncalibrated sheet.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  AGENT_TOOL_DEFS, executeAgentTool, validateToolArgs, pickAgentEvidence,
  agentScaleGate, EVIDENCE_MAX_CHARS,
} from "../src/lib/agentTools.js";

// A canvas-shaped capability stub. Every mutation is recorded so the tests can
// assert what executed — and, for the probe tools, what did NOT.
function makeCtx(overrides: Record<string, unknown> = {}) {
  const calls: Record<string, unknown[]> = { proposeShapes: [], createCondition: [], oneClick: [] };
  const ctx = {
    listSheets: () => [{ sheet: "plan.pdf", title: "A101", width: 2000, height: 1500, scale_set: true }],
    sheetDims: (k: string) => (k === "plan.pdf" ? { w: 2000, h: 1500 } : null),
    uppFor: (k: string) => (k === "plan.pdf" ? 0.02 : null),
    detectedLabel: () => "",
    readSheetText: async () => [{ text: "RM 204", x: 0.4, y: 0.5 }],
    readSchedule: async () => [{ finish_tag: "CPT-1", section: "FLOORING", category: "floor", description: "CARPET", manufacturer: "", style: "", spec_color: "", size: "", suggested: true }],
    // Extra `_debug` key present on purpose: view_region must return an EXPLICIT
    // pick, so a naive `return img` would leak it — the key-set assertion catches that.
    viewRegion: async () => ({ image_data_url: "data:image/png;base64,AAAA", width: 100, height: 80, _debug: "internal" }),
    oneClick: async (sheet: string, x: number, y: number) => {
      calls.oneClick.push([sheet, x, y]);
      return { verts_norm: [[0.1, 0.1], [0.3, 0.1], [0.3, 0.3], [0.1, 0.3]], area_sf: 200, perimeter_lf: 60, seed_norm: [x, y] };
    },
    getConditions: () => [{ id: "cnd-1", finish_tag: "CPT-1", hatch: "solid", waste_pct: 5 }],
    createCondition: (tag: string) => { calls.createCondition.push(tag); return { id: `cnd-${tag}`, finish_tag: tag }; },
    proposeShapes: (shapes: unknown[]) => { calls.proposeShapes.push(shapes); return { staged: shapes.length }; },
    ...overrides,
  };
  return { ctx, calls };
}

test("registry: every tool has a name, description, and object schema; names are unique", () => {
  assert.ok(AGENT_TOOL_DEFS.length >= 8);
  const names = new Set<string>();
  for (const d of AGENT_TOOL_DEFS) {
    assert.ok(d.name && typeof d.name === "string");
    assert.ok(d.description.length > 20, `${d.name} needs a real description`);
    assert.equal(d.input_schema.type, "object");
    assert.ok(Array.isArray(d.input_schema.required), `${d.name} schema needs required[]`);
    assert.ok(!names.has(d.name), `duplicate tool name ${d.name}`);
    names.add(d.name);
  }
  for (const expected of ["list_sheets", "read_sheet_text", "read_schedule", "view_region", "one_click", "get_conditions", "create_condition", "propose_shapes"]) {
    assert.ok(names.has(expected), `missing tool ${expected}`);
  }
});

test("validateToolArgs: required keys and primitive types enforced", () => {
  const schema = AGENT_TOOL_DEFS.find((d) => d.name === "one_click")!.input_schema;
  assert.equal(validateToolArgs(schema, { sheet: "plan.pdf", x: 0.5, y: 0.5 }), null);
  assert.match(validateToolArgs(schema, { x: 0.5, y: 0.5 })!, /missing required argument: sheet/);
  assert.match(validateToolArgs(schema, { sheet: "plan.pdf", x: "mid", y: 0.5 })!, /x must be a number/);
  assert.match(validateToolArgs(schema, null)!, /must be a JSON object/);
});

test("unknown tool → error RESULT, never a throw", async () => {
  const { ctx } = makeCtx();
  const out = await executeAgentTool(ctx, "summon_geometry", {});
  // Verbatim: the unknown-tool message lists every real tool so the model can
  // self-correct. Byte-identical guard — the exact string is the contract.
  assert.equal(
    out.error,
    "Unknown tool: summon_geometry. Available: list_sheets, read_sheet_text, read_schedule, view_region, one_click, get_conditions, create_condition, propose_shapes.",
  );
});

test("unknown tool colliding with an Object.prototype key → error RESULT, never a leaked prototype fn", async () => {
  // The switch→handler-map move dispatches through HANDLERS[name]. A plain-object
  // map inherits Object.prototype, so a name like `toString`/`constructor` would
  // resolve to an inherited function and get called — the old switch matched only
  // its string-literal cases and fell through to the unknown-tool default. Each of
  // these must return that default result (no "Available:" list — they clear the
  // !def gate by inheritance, exactly as they did before the refactor).
  const { ctx } = makeCtx();
  for (const name of ["toString", "valueOf", "hasOwnProperty", "constructor", "__proto__", "isPrototypeOf"]) {
    const out = await executeAgentTool(ctx, name, {});
    assert.equal(out.error, `Unknown tool: ${name}.`, `${name} must fall through to the unknown-tool default`);
    assert.equal(typeof out, "object", `${name} must not leak a non-object result`);
  }
});

// ── per-tool characterization: success + error for all 8 tools ─────────────────
// These pin behavior byte-for-byte across the switch→handler-map refactor. Where
// the message wording differs BETWEEN tools (e.g. the sheet-not-open text), each
// is asserted verbatim so nobody "helpfully" unifies them during the move.

test("list_sheets: success returns the ctx sheet list; a capability throw is caught", async () => {
  const { ctx } = makeCtx();
  const out = await executeAgentTool(ctx, "list_sheets", {});
  assert.deepEqual(out, { sheets: [{ sheet: "plan.pdf", title: "A101", width: 2000, height: 1500, scale_set: true }] });
  const { ctx: boom } = makeCtx({ listSheets: () => { throw new Error("registry gone"); } });
  const err = await executeAgentTool(boom, "list_sheets", {});
  assert.equal(err.error, "Tool list_sheets failed: registry gone");
});

test("read_sheet_text: success returns count+items; closed sheet refuses verbatim", async () => {
  const { ctx } = makeCtx();
  const out = await executeAgentTool(ctx, "read_sheet_text", { sheet: "plan.pdf" });
  assert.deepEqual(out, { count: 1, items: [{ text: "RM 204", x: 0.4, y: 0.5 }] });
  const closed = await executeAgentTool(ctx, "read_sheet_text", { sheet: "ghost.pdf" });
  assert.equal(closed.error, "Sheet ghost.pdf isn't open on the canvas — ask the estimator to open it, or pick one from list_sheets.");
});

test("read_schedule: success returns rows; empty region → non-error note; closed sheet refuses verbatim", async () => {
  const { ctx } = makeCtx();
  const region = { x0: 0.1, y0: 0.1, x1: 0.9, y1: 0.9 };
  const out = await executeAgentTool(ctx, "read_schedule", { sheet: "plan.pdf", region });
  assert.equal(out.rows.length, 1);
  assert.equal(out.rows[0].finish_tag, "CPT-1");
  const { ctx: empty } = makeCtx({ readSchedule: async () => [] });
  const none = await executeAgentTool(empty, "read_schedule", { sheet: "plan.pdf", region });
  assert.deepEqual(none, { rows: [], note: "No schedule table found in that region — draw the region around the table including its CODE / MATERIAL / ... header, or use view_region to look at the area." });
  const closed = await executeAgentTool(ctx, "read_schedule", { sheet: "ghost.pdf", region });
  assert.equal(closed.error, "Sheet ghost.pdf isn't open on the canvas — pick one from list_sheets.");
});

test("view_region: success returns exactly {image_data_url,width,height}; closed sheet refuses verbatim", async () => {
  const { ctx } = makeCtx();
  const region = { x0: 0.1, y0: 0.1, x1: 0.9, y1: 0.9 };
  const out = await executeAgentTool(ctx, "view_region", { sheet: "plan.pdf", region });
  // Exact key set — a naive `return img` would leak extra fields; this catches it.
  assert.deepEqual(Object.keys(out).sort(), ["height", "image_data_url", "width"]);
  assert.equal(out.image_data_url, "data:image/png;base64,AAAA");
  assert.equal(out.width, 100);
  assert.equal(out.height, 80);
  const closed = await executeAgentTool(ctx, "view_region", { sheet: "ghost.pdf", region });
  assert.equal(closed.error, "Sheet ghost.pdf isn't open on the canvas — pick one from list_sheets.");
});

test("one_click: closed sheet refuses verbatim (success + scale-gate covered elsewhere)", async () => {
  const { ctx } = makeCtx();
  const closed = await executeAgentTool(ctx, "one_click", { sheet: "ghost.pdf", x: 0.5, y: 0.5 });
  assert.equal(closed.error, "Sheet ghost.pdf isn't open on the canvas — pick one from list_sheets.");
});

test("get_conditions: success returns the ctx conditions; a capability throw is caught", async () => {
  const { ctx } = makeCtx();
  const out = await executeAgentTool(ctx, "get_conditions", {});
  assert.deepEqual(out, { conditions: [{ id: "cnd-1", finish_tag: "CPT-1", hatch: "solid", waste_pct: 5 }] });
  const { ctx: boom } = makeCtx({ getConditions: () => { throw new Error("conditions gone"); } });
  const err = await executeAgentTool(boom, "get_conditions", {});
  assert.equal(err.error, "Tool get_conditions failed: conditions gone");
});

test("create_condition: whitespace-only tag rejects verbatim (pins .trim())", async () => {
  const { ctx, calls } = makeCtx();
  const out = await executeAgentTool(ctx, "create_condition", { finish_tag: "   " });
  assert.equal(out.error, "finish_tag must be a non-empty string.");
  assert.equal(calls.createCondition.length, 0);
});

test("bad args → error RESULT naming the problem", async () => {
  const { ctx } = makeCtx();
  const out = await executeAgentTool(ctx, "one_click", { sheet: "plan.pdf" });
  assert.match(out.error, /Invalid arguments for one_click/);
});

test("one_click probes without mutating anything", async () => {
  const { ctx, calls } = makeCtx();
  const out = await executeAgentTool(ctx, "one_click", { sheet: "plan.pdf", x: 0.5, y: 0.5 });
  assert.equal(out.area_sf, 200);
  assert.equal(out.verts_norm.length, 4);
  assert.deepEqual(calls.oneClick, [["plan.pdf", 0.5, 0.5]]);
  assert.equal(calls.proposeShapes.length, 0);     // a probe stages NOTHING
  assert.equal(calls.createCondition.length, 0);
});

test("one_click scale gate: uncalibrated sheet refuses with the shared gate text", async () => {
  const { ctx, calls } = makeCtx({ uppFor: () => null, detectedLabel: () => '1/8" = 1\'-0"' });
  const out = await executeAgentTool(ctx, "one_click", { sheet: "plan.pdf", x: 0.5, y: 0.5 });
  assert.equal(out.error, agentScaleGate("plan.pdf", '1/8" = 1\'-0"'));
  assert.match(out.error, /^Set the scale for plan\.pdf first — /);   // the MCP gate's opening line
  assert.match(out.error, /detected: 1\/8/);
  assert.equal(calls.oneClick.length, 0);          // the engine never even ran
});

test("propose_shapes: evidence whitelist — junk keys dropped, strings truncated, uncited rejected", async () => {
  const { ctx, calls } = makeCtx();
  const long = "X".repeat(500);
  const ring = [[0.1, 0.1], [0.3, 0.1], [0.3, 0.3], [0.1, 0.3]];
  const out = await executeAgentTool(ctx, "propose_shapes", {
    shapes: [
      { sheet: "plan.pdf", verts_norm: ring, condition_id: "cnd-1", measure_role: "floor_area",
        evidence: { schedule_row_tag: "CPT-1", matched_text: long, seed_norm: [0.5, 0.5], prompt_text: "sneaky", room_transcript: long } },
      { sheet: "plan.pdf", verts_norm: ring, condition_id: "cnd-1", measure_role: "floor_area",
        evidence: { prompt_text: "junk only — nothing whitelisted survives" } },
    ],
  });
  assert.equal(out.staged, 1);
  assert.equal(out.rejected.length, 1);
  assert.match(out.rejected[0], /must cite evidence/);
  const staged = (calls.proposeShapes[0] as Record<string, any>[])[0];
  assert.deepEqual(Object.keys(staged.evidence).sort(), ["matched_text", "schedule_row_tag", "seed_norm"]);
  assert.equal(staged.evidence.matched_text.length, EVIDENCE_MAX_CHARS);   // truncated, hard line
  assert.equal(staged.evidence.schedule_row_tag, "CPT-1");
});

test("propose_shapes: unknown condition, bad role, degenerate ring, and unscaled sheet all reject", async () => {
  const { ctx, calls } = makeCtx({ uppFor: (k: string) => (k === "plan.pdf" ? 0.02 : null), sheetDims: (k: string) => (k === "plan.pdf" || k === "scan.pdf" ? { w: 2000, h: 1500 } : null) });
  const ev = { schedule_row_tag: "CPT-1" };
  const ring = [[0.1, 0.1], [0.3, 0.1], [0.3, 0.3]];
  const out = await executeAgentTool(ctx, "propose_shapes", {
    shapes: [
      { sheet: "plan.pdf", verts_norm: ring, condition_id: "cnd-404", measure_role: "floor_area", evidence: ev },
      { sheet: "plan.pdf", verts_norm: ring, condition_id: "cnd-1", measure_role: "linear", evidence: ev },
      { sheet: "plan.pdf", verts_norm: [[0.1, 0.1], [0.2, 0.2]], condition_id: "cnd-1", measure_role: "floor_area", evidence: ev },
      { sheet: "scan.pdf", verts_norm: ring, condition_id: "cnd-1", measure_role: "floor_area", evidence: ev },   // no scale
      { sheet: "ghost.pdf", verts_norm: ring, condition_id: "cnd-1", measure_role: "floor_area", evidence: ev },  // not open
    ],
  });
  assert.equal(out.staged, 0);
  assert.equal(out.rejected.length, 5);
  assert.equal(calls.proposeShapes.length, 0);   // nothing valid → the canvas is never touched
  assert.match(out.rejected[3], /^Set the scale for scan\.pdf first/);
});

test("create_condition dedupes by tag instead of minting twins", async () => {
  const { ctx, calls } = makeCtx();
  const dup = await executeAgentTool(ctx, "create_condition", { finish_tag: "cpt-1" });
  assert.equal(dup.condition_id, "cnd-1");
  assert.equal(dup.note, "already existed");
  assert.equal(calls.createCondition.length, 0);
  const fresh = await executeAgentTool(ctx, "create_condition", { finish_tag: "LVT-2" });
  assert.equal(fresh.condition_id, "cnd-LVT-2");
  assert.deepEqual(calls.createCondition, ["LVT-2"]);
});

test("a capability throw becomes an error result (the loop must never crash)", async () => {
  const { ctx } = makeCtx({ readSheetText: async () => { throw new Error("text layer exploded"); } });
  const out = await executeAgentTool(ctx, "read_sheet_text", { sheet: "plan.pdf" });
  assert.match(out.error, /read_sheet_text failed: text layer exploded/);
});

test("pickAgentEvidence: null-safe, array-safe, whitelist-only", () => {
  assert.equal(pickAgentEvidence(null), null);
  assert.equal(pickAgentEvidence([1, 2]), null);
  assert.equal(pickAgentEvidence({ junk: 1 }), null);
  assert.deepEqual(pickAgentEvidence({ matched_text: "RM 204", junk: 1 }), { matched_text: "RM 204" });
});
