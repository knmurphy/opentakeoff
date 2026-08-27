// Generates 3d-view-test.otk — a one-click test project for the 3D view.
//
//   cd web && node test/fixtures/make-3d-test-project.mjs
//
// The .otk (projectArchive.js v1: zip { opentakeoff.project.json, plans/*.pdf })
// opens from the app's Open button / drag-drop and carries EVERY 3D-relevant
// case, so the view can be verified without drawing anything:
//
//   CPT-1  floor, NO thickness      → nominal-thin slab + legend note
//   LVT-1  floor, thickness 1/4"    → true-thickness slab
//   RB-1   base (vertical, 4")      → derived ring on Room A: interior inset,
//                                     translucent-derived look, openings note
//   TR-1   flush transition         → strip spanning A|B at the higher floor
//   WT-1   wall tile (surface, 4')  → vertical ribbon along Room A's north wall
//   CG-1   corner guards (count 4') → three posts at Room A's corners + ONE
//                                     per-shape override at 50 ft (unmistakable
//                                     spike proving per-instance instancing)
//   DED-1  standalone deduct        → red "excluded area" volume + caption
//
// Geometry is synthetic rectangles in normalized sheet coords — the 3D view
// doesn't care what the plan drawing shows underneath.

import { zipSync, strToU8 } from "fflate";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const pdf = readFileSync(join(here, "../../public/demo/sample-finish-plan.pdf"));

const SHEET = "sample-finish-plan.pdf";
const UP = 0.05555555555555555; // 1/8" = 1'-0" on the demo sheet (scale-detected value)

// normalized rectangles (x0,y0,x1,y1), y down, inside the demo sheet's frame
const rect = (x0, y0, x1, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
const ROOM_A = rect(0.22, 0.30, 0.42, 0.55); // CPT-1
const ROOM_B = rect(0.42, 0.30, 0.62, 0.55); // LVT-1 — shares the x=0.42 wall with A
const DEDUCT = rect(0.24, 0.32, 0.28, 0.36); // inside Room A, standalone (never reconciled)
const WALL_A_NORTH = [[0.22, 0.30], [0.42, 0.30]]; // Room A's top edge, left→right
const TRANSITION = [[0.42, 0.38], [0.42, 0.50]];   // the A|B shared wall

const mk = (over) => ({ id: over.id, sheet_id: SHEET, computed: {}, label: null, origin: null, ...over });

const conditions = [
  { id: "cnd-t-cpt", finish_tag: "CPT-1", color: "#2f7d54", fill: "#2f7d54", hatch: "speckle", multiplier: 1, waste_pct: 5, materials: [] },
  { id: "cnd-t-lvt", finish_tag: "LVT-1", color: "#b8860b", fill: "#b8860b", hatch: "plank", multiplier: 1, waste_pct: 8, thickness_in: 0.25, materials: [] },
  { id: "cnd-t-rb", finish_tag: "RB-1", color: "#475569", fill: "#475569", hatch: "horiz", multiplier: 1, waste_pct: 5, extrude_mode: "vertical", extrude_h_ft: 1 / 3, materials: [] },
  { id: "cnd-t-tr", finish_tag: "TR-1", color: "#c96442", fill: "#c96442", hatch: "vert", multiplier: 1, waste_pct: 0, extrude_mode: "flush", thickness_in: 0.25, materials: [] },
  { id: "cnd-t-wt", finish_tag: "WT-1", color: "#2563eb", fill: "#2563eb", hatch: "grid", multiplier: 1, waste_pct: 10, height_ft: 4, materials: [] },
  { id: "cnd-t-cg", finish_tag: "CG-1", color: "#0ea5e9", fill: "#0ea5e9", hatch: "vert", multiplier: 1, waste_pct: 0, extrude_h_ft: 4, materials: [] },
  { id: "cnd-t-ded", finish_tag: "DED-1", color: "#b03a26", fill: "#b03a26", hatch: "cross", multiplier: 1, waste_pct: 0, extrude_h_ft: 3, materials: [] },
];

const lf = (v) => Math.round(v * 100) / 100; // stand-in quantities — recomputed on load/edit anyway

const shapes = [
  mk({ id: "shp-t-floorA", condition_id: "cnd-t-cpt", measure_role: "floor_area", verts_norm: ROOM_A,
       computed: { area_sf: 300, perimeter_lf: 75 } }),
  mk({ id: "shp-t-floorB", condition_id: "cnd-t-lvt", measure_role: "floor_area", verts_norm: ROOM_B,
       computed: { area_sf: 350, perimeter_lf: 80 } }),
  // derived base ring for Room A — from_shape_id drives interior inset + openings note
  mk({ id: "shp-t-baseA", condition_id: "cnd-t-rb", measure_role: "linear",
       verts_norm: [...ROOM_A, ROOM_A[0]], computed: { area_sf: 0, perimeter_lf: 72 },
       origin: { method: "agent_v1", actor: "agent", reviewed: false, derived: { from_shape_id: "shp-t-floorA", gross_lf: 75, openings_lf: 3 } } }),
  // flush transition where A meets B — between_shape_ids drives the higher-floor z0
  mk({ id: "shp-t-trans", condition_id: "cnd-t-tr", measure_role: "linear",
       verts_norm: TRANSITION, computed: { area_sf: 0, perimeter_lf: lf(0.12 / UP) },
       origin: { method: "agent_v1", actor: "agent", reviewed: false, derived: { between_shape_ids: ["shp-t-floorA", "shp-t-floorB"], between: ["CPT-1", "LVT-1"], case: "butt", gap_in: 0 } } }),
  // wall tile up Room A's north wall — shape-snapshotted height
  mk({ id: "shp-t-wallA", condition_id: "cnd-t-wt", measure_role: "surface_area", verts_norm: WALL_A_NORTH,
       height_ft: 4, computed: { area_sf: 40, perimeter_lf: 10 } }),
  // three guards at Room A's corners + one 50 ft per-shape override (the spike)
  mk({ id: "shp-t-g1", condition_id: "cnd-t-cg", measure_role: "count", verts_norm: [[0.22, 0.30]], computed: { count: 1 }, extrude_h_ft: 4 }),
  mk({ id: "shp-t-g2", condition_id: "cnd-t-cg", measure_role: "count", verts_norm: [[0.42, 0.30]], computed: { count: 1 }, extrude_h_ft: 4 }),
  mk({ id: "shp-t-g3", condition_id: "cnd-t-cg", measure_role: "count", verts_norm: [[0.22, 0.55]], computed: { count: 1 }, extrude_h_ft: 4 }),
  mk({ id: "shp-t-g4", condition_id: "cnd-t-cg", measure_role: "count", verts_norm: [[0.42, 0.55]], computed: { count: 1 }, extrude_h_ft: 50, extrude_override: true }),
  // standalone (never-reconciled) deduct inside Room A → excluded volume + caption
  mk({ id: "shp-t-ded", condition_id: "cnd-t-ded", measure_role: "deduct", verts_norm: DEDUCT,
       computed: { area_sf: 25, perimeter_lf: 20 } }),
];

const takeoff = {
  schema: "opentakeoff.takeoff_canvas.v1",
  conditions, shapes,
  markups: [], rfis: [], rules: [], approvals: [], stitches: [],
  sheets: [{ sheet_id: SHEET, units_per_px: UP, scale_source: "preset" }],
  sheet_group: [], last_group: [], sheet_tabs: [],
};

const manifest = {
  schema: "opentakeoff.project_archive.v1",
  app: "opentakeoff",
  created: new Date().toISOString(),
  project_name: "3D VIEW TEST",
  plans: [SHEET],
  takeoff,
};

const bytes = zipSync({
  "opentakeoff.project.json": [strToU8(JSON.stringify(manifest, null, 2)), { level: 6 }],
  [`plans/${SHEET}`]: [new Uint8Array(pdf), { level: 0 }],
});

const out = join(here, "3d-view-test.otk");
writeFileSync(out, bytes);
console.log(`wrote ${out} (${(bytes.length / 1024).toFixed(1)} KB) — open it from the app's Open button`);
