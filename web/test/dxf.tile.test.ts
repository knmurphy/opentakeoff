// DXF export — tile grid layer (M8). A tile_setup condition's solved grid
// (tileTakeoff's per-shape layout.classified, pre-solved and threaded in by
// the caller as DxfShape.tile_cells) rides into CAD as its own OT-<TAG>
// -TILEGRID layer of closed LWPOLYLINEs, one per kept (full/cut/corner)
// cell, in the SAME bottom-left/Y-up frame every other entity uses. A shape
// with no tile_cells (no tile_setup) is untouched — byte-identical to the
// pre-M8 contract dxf.test.ts already pins.
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildSheetDxf } from "../src/lib/dxf.ts";

const SHEET = "plan.pdf#1";
const DIMS = { w: 3000, h: 2000 };
const UPP = 0.05;   // 20 px per foot → 150 ft × 100 ft sheet
const CONDS = [
  { id: "c1", finish_tag: "LVT-1" },
  { id: "c2", finish_tag: "CPT-2" },
];

/** Parse a DXF text into [code, value] pairs. */
function pairs(dxf: string): [number, string][] {
  const lines = dxf.split("\n");
  const out: [number, string][] = [];
  for (let i = 0; i + 1 < lines.length; i += 2) out.push([Number(lines[i]), lines[i + 1]]);
  return out;
}

/** Entities in the ENTITIES section as {type, layer, pts, closed, color}. */
function entities(dxf: string) {
  const p = pairs(dxf);
  const start = p.findIndex(([c, v], i) => c === 2 && v === "ENTITIES" && p[i - 1][1] === "SECTION");
  const ents: { type: string; layer: string; pts: [number, number][]; closed: boolean; color?: number }[] = [];
  let cur: (typeof ents)[number] | null = null;
  for (let i = start + 1; i < p.length; i++) {
    const [c, v] = p[i];
    if (c === 0) {
      if (v === "ENDSEC") break;
      cur = { type: v, layer: "", pts: [], closed: false };
      ents.push(cur);
    } else if (cur) {
      if (c === 8) cur.layer = v;
      if (c === 62) cur.color = Number(v);
      if (c === 10) cur.pts.push([Number(v), 0]);
      if (c === 20) cur.pts[cur.pts.length - 1][1] = Number(v);
      if (c === 70) cur.closed = (Number(v) & 1) === 1;
    }
  }
  return ents;
}

// A 4 ft × 4 ft tiled room at the sheet's origin (ring_ft frame: x right, y
// down from the top-left, feet — the same frame tileTakeoff's ring_ft and
// TakeoffCanvas's tileOverlayForShape hand quad geometry in). Four 2×2 ft
// cells: two full, one cut, one corner — plus a "hole" cell (fully inside a
// deduct) that MUST be skipped, proving the layer isn't just "every cell".
const tiledRoom = {
  id: "s1", sheet_id: SHEET, condition_id: "c1", measure_role: "floor_area",
  verts_norm: [[0, 0], [4 / 150, 0], [4 / 150, 4 / 100], [0, 4 / 100]] as [number, number][],
  tile_cells: [
    { cls: "full", pts_ft: [[0, 0], [2, 0], [2, 2], [0, 2]] as [number, number][] },
    { cls: "full", pts_ft: [[2, 0], [4, 0], [4, 2], [2, 2]] as [number, number][] },
    { cls: "cut", pts_ft: [[0, 2], [2, 2], [2, 4], [0, 4]] as [number, number][] },
    { cls: "corner", pts_ft: [[2, 2], [4, 2], [4, 4], [2, 4]] as [number, number][] },
    { cls: "hole", pts_ft: [[10, 10], [11, 10], [11, 11], [10, 11]] as [number, number][] },
  ],
};

// Non-tiled control room — same shape of input as any pre-M8 caller.
const plainRoom = {
  id: "s2", sheet_id: SHEET, condition_id: "c2", measure_role: "floor_area",
  verts_norm: [[0.2, 0.2], [0.4, 0.2], [0.4, 0.4], [0.2, 0.4]] as [number, number][],
};

test("a tile_setup condition's solved grid lands on OT-<TAG>-TILEGRID, kept cells only, in the CAD Y-up frame", () => {
  const b = buildSheetDxf({ sheet_id: SHEET, dims: DIMS, upp: UPP, shapes: [tiledRoom], conditions: CONDS });
  assert.ok(b.layers.includes("OT-LVT-1-TILEGRID"), `expected OT-LVT-1-TILEGRID among ${b.layers.join(", ")}`);
  const e = entities(b.dxf);
  const grid = e.filter((x) => x.layer === "OT-LVT-1-TILEGRID");
  // 4 kept cells (full×2, cut, corner) — the "hole" cell is excluded.
  assert.equal(grid.length, 4);
  assert.ok(grid.every((c) => c.type === "LWPOLYLINE" && c.closed), "every grid cell is a closed LWPOLYLINE");
  // Sheet is 150 ft × 100 ft (w·upp × h·upp); a cell at feet (0,0)-(2,2) in
  // the ring_ft (y-down) frame flips to CAD Y-up: y' = 100 − y.
  const first = grid[0];
  assert.deepEqual(first.pts, [[0, 100], [2, 100], [2, 98], [0, 98]]);
  // full cells carry no color override (BYLAYER = the condition's color);
  // cut/corner cells get a distinct override so they read apart on-screen.
  const full = grid.filter((c) => c.color === undefined);
  const cut = grid.filter((c) => c.color !== undefined);
  assert.equal(full.length, 2, "two full cells, no color override");
  assert.equal(cut.length, 2, "cut + corner cells carry a color override");
  assert.ok(new Set(cut.map((c) => c.color)).size === 1, "cut and corner share one override color");
});

test("more grid entities than a non-tiled control room emits for its own ring", () => {
  const b = buildSheetDxf({ sheet_id: SHEET, dims: DIMS, upp: UPP, shapes: [tiledRoom, plainRoom], conditions: CONDS });
  const e = entities(b.dxf);
  const tiledEnts = e.filter((x) => x.layer === "OT-LVT-1" || x.layer === "OT-LVT-1-TILEGRID");
  const plainEnts = e.filter((x) => x.layer === "OT-CPT-2");
  assert.equal(plainEnts.length, 1, "the control room emits only its own ring");
  assert.ok(tiledEnts.length > plainEnts.length, "the tiled room emits its ring PLUS the grid, so strictly more entities");
  assert.equal(tiledEnts.length, 1 + 4, "ring + 4 kept cells");
});

test("no tile_setup (no tile_cells) → no TILEGRID layer, output unchanged from the pre-M8 contract", () => {
  const b = buildSheetDxf({ sheet_id: SHEET, dims: DIMS, upp: UPP, shapes: [plainRoom], conditions: CONDS });
  assert.ok(!b.layers.some((l) => l.endsWith("-TILEGRID")), `no TILEGRID layer expected, got ${b.layers.join(", ")}`);
  assert.equal(b.entities, 1);
  const bEmptyCells = buildSheetDxf({ sheet_id: SHEET, dims: DIMS, upp: UPP, shapes: [{ ...plainRoom, tile_cells: [] }], conditions: CONDS });
  assert.deepEqual(bEmptyCells.layers, b.layers, "an empty tile_cells array is a no-op too");
  assert.equal(bEmptyCells.dxf, b.dxf, "byte-identical output when there is nothing to draw");
});

test("a deduct shape never gets a TILEGRID layer even if it happened to carry tile_cells", () => {
  const deduct = { id: "d1", sheet_id: SHEET, condition_id: "c1", measure_role: "deduct",
    verts_norm: [[0.5, 0.5], [0.52, 0.5], [0.52, 0.52]] as [number, number][],
    tile_cells: [{ cls: "full", pts_ft: [[0, 0], [1, 0], [1, 1], [0, 1]] as [number, number][] }] };
  const b = buildSheetDxf({ sheet_id: SHEET, dims: DIMS, upp: UPP, shapes: [deduct], conditions: CONDS });
  assert.ok(!b.layers.some((l) => l.endsWith("-TILEGRID")), "deduct rings never carry a tile grid");
});
