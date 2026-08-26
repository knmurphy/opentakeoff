// web/test/tileQA.test.ts
//
// tileWarnings — the multi-room batch QA aggregator (design §2.I, M5 Task 4).
import { test } from "node:test";
import assert from "node:assert/strict";
import { mintTileSetup, type TileSetup } from "../src/lib/tileSetup.ts";
import { tileWarnings } from "../src/lib/tileQA.ts";

// A 4.25ft x 4ft room sitting inside a 10ft x 10ft sheet (1000x1000px at
// upp=0.01 ft/px), so a sliver quad's nominal center — which can sit just
// past the room's own edge — still lands well inside the [0,1] normalized
// sheet frame the panel pans to.
const DIMS = { w: 1000, h: 1000 };
const UPP = 0.01;
const ROOM_VERTS: [number, number][] = [
  [0, 0],
  [0.425, 0],
  [0.425, 0.4],
  [0, 0.4],
];

function makeCondition(id: string, tile_setup: TileSetup) {
  return { id, finish_tag: "CT-1", tile_setup };
}

function makeShape(id: string, condition_id: string, sheet_id = "sheet1") {
  return { id, condition_id, sheet_id, measure_role: "floor_area", verts_norm: ROOM_VERTS };
}

const dimsFor = (sheetId: string | undefined) => (sheetId === "sheet1" ? DIMS : null);
const uppFor = (sheetId: string | undefined) => (sheetId === "sheet1" ? UPP : null);

test("tileWarnings: no tile conditions → empty array", () => {
  assert.deepEqual(tileWarnings([], [], dimsFor, uppFor), []);
  assert.deepEqual(tileWarnings([{ id: "c1" }], [], dimsFor, uppFor), []);
});

test("tileWarnings: origin [0,0] on a 4.25ft-wide room strands a hairline sliver", () => {
  const ts = mintTileSetup();
  ts.skus[0].w_in = 12;
  ts.skus[0].h_in = 12;
  ts.joint.width_in = 0;
  ts.origin = [0, 0];
  const cond = makeCondition("c1", ts);
  const shape = makeShape("s1", "c1");

  const warnings = tileWarnings([cond], [shape], dimsFor, uppFor);
  const slivers = warnings.filter((w) => w.kind === "sliver");
  assert.ok(slivers.length > 0, "expected at least one sliver warning");
  for (const w of slivers) {
    assert.equal(w.condition_id, "c1");
    assert.equal(w.shape_id, "s1");
    assert.equal(w.finish_tag, "CT-1");
    assert.equal(w.sheet_id, "sheet1");
    assert.ok(w.at_norm, "sliver warning carries an at_norm focus target");
    const [nx, ny] = w.at_norm as [number, number];
    assert.ok(nx >= 0 && nx <= 1, `at_norm.x ${nx} inside [0,1]`);
    assert.ok(ny >= 0 && ny <= 1, `at_norm.y ${ny} inside [0,1]`);
  }
});

test("tileWarnings: a balanced/centered origin on the same room yields no sliver warning", () => {
  const ts = mintTileSetup();
  ts.skus[0].w_in = 12;
  ts.skus[0].h_in = 12;
  ts.joint.width_in = 0;
  // The balanced origin optimizeOrigin finds for this exact room (see
  // tileOptimize.test.ts) — two ~7.5in cuts, neither sub-half.
  ts.origin = [0.625, 0];
  const cond = makeCondition("c1", ts);
  const shape = makeShape("s1", "c1");

  const warnings = tileWarnings([cond], [shape], dimsFor, uppFor);
  assert.equal(warnings.filter((w) => w.kind === "sliver").length, 0);
});

test("tileWarnings: an unscaled sheet yields an 'unscaled' warning and does not crash", () => {
  const ts = mintTileSetup();
  const cond = makeCondition("c1", ts);
  const shape = makeShape("s1", "c1", "sheet2");
  const warnings = tileWarnings(
    [cond],
    [shape],
    (sheetId) => (sheetId === "sheet2" ? DIMS : null),
    (sheetId) => (sheetId === "sheet2" ? 0 : null),
  );
  assert.equal(warnings.length, 1);
  assert.equal(warnings[0].kind, "unscaled");
  assert.equal(warnings[0].shape_id, "s1");
  assert.equal(warnings[0].sheet_id, "sheet2");
});

test("tileWarnings: a tile_setup whose layoutWarning is non-null surfaces a 'layout' warning", () => {
  const ts = mintTileSetup();
  ts.pattern = "herringbone";
  ts.skus[0].w_in = 12;
  ts.skus[0].h_in = 12; // 1:1, not the 2:1 herringbone needs — gap-free warning fires
  const cond = makeCondition("c1", ts);
  const shape = makeShape("s1", "c1");

  const warnings = tileWarnings([cond], [shape], dimsFor, uppFor);
  const layout = warnings.filter((w) => w.kind === "layout");
  assert.equal(layout.length, 1);
  assert.match(layout[0].detail, /herringbone/i);
});
