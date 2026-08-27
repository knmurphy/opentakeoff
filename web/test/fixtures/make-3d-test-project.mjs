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
//   RC-1   roll-goods carpet (2 rooms, roll_setup on the condition):
//            small room  11×8 ft   → single lane (< 11.5 ft n=1 cap) — banded,
//                                     no seam, parity check
//            L room      30×20 ft,
//            10×8 ft notch          → multi-lane bands + seams; the notch
//                                     corner must NOT be striped (concave clip)
//
// Geometry is synthetic rectangles (plus one L-shaped hexagon) in normalized
// sheet coords — the 3D view doesn't care what the plan drawing shows
// underneath. Roll-goods room sizes are chosen against REAL feet (see
// FT_PER_NORM_X/Y below) so the single-lane case is provably under the
// roll-goods engine's n=1 cap, not just visually small.

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

// Roll-goods rooms are placed by REAL feet, not eyeballed normalized units, so
// the single-lane case is provably under the engine's n=1 cap (rollgoods.js
// computeLaneCount: capacity(n=1) = roll_width_ft*12 - 2*wall_overage_in =
// 144 - 6 = 138in = 11.5ft, for the roll_setup defaults minted below). The
// demo sheet's MediaBox is 3024×2160pt; sheets.ts rasters at RENDER_SCALE=2
// (72pt/in → 144dpi), so dims.w=6048px, dims.h=4320px, and rollTakeoff.js
// maps verts_norm → feet as norm * dims.* * UP.
const FT_PER_NORM_X = 6048 * UP; // 336 ft per normalized x unit
const FT_PER_NORM_Y = 4320 * UP; // 240 ft per normalized y unit
const nx = (ft) => ft / FT_PER_NORM_X;
const ny = (ft) => ft / FT_PER_NORM_Y;
const ROLL_SINGLE_X0 = 0.68, ROLL_SINGLE_Y0 = 0.30;
// 11×8 ft — both extents under the 11.5 ft cap, so it comes out single-lane
// (n=1) no matter which axis the roll_setup "auto" direction picks.
const ROLL_SINGLE = rect(ROLL_SINGLE_X0, ROLL_SINGLE_Y0, ROLL_SINGLE_X0 + nx(11), ROLL_SINGLE_Y0 + ny(8));
const ROLL_L_X0 = 0.68, ROLL_L_Y0 = 0.40;
const ROLL_L_X1 = ROLL_L_X0 + nx(30), ROLL_L_Y1 = ROLL_L_Y0 + ny(20); // 30×20 ft outer envelope
const ROLL_L_XN = ROLL_L_X1 - nx(10), ROLL_L_YN = ROLL_L_Y0 + ny(8);  // 10×8 ft notch cut from the top-right corner
// L-shaped hexagon (concave at [ROLL_L_XN, ROLL_L_YN]) — wide enough (30 ft)
// to force multiple lanes, so headed validation can confirm the notch corner
// stays unstriped (the payload builder's footprint clip) alongside the seams.
const ROLL_L = [
  [ROLL_L_X0, ROLL_L_Y0], [ROLL_L_XN, ROLL_L_Y0], [ROLL_L_XN, ROLL_L_YN],
  [ROLL_L_X1, ROLL_L_YN], [ROLL_L_X1, ROLL_L_Y1], [ROLL_L_X0, ROLL_L_Y1],
];

const mk = (over) => ({ id: over.id, sheet_id: SHEET, computed: {}, label: null, origin: null, ...over });

const conditions = [
  { id: "cnd-t-cpt", finish_tag: "CPT-1", color: "#2f7d54", fill: "#2f7d54", hatch: "speckle", multiplier: 1, waste_pct: 5, materials: [] },
  { id: "cnd-t-lvt", finish_tag: "LVT-1", color: "#b8860b", fill: "#b8860b", hatch: "plank", multiplier: 1, waste_pct: 8, thickness_in: 0.25, materials: [] },
  { id: "cnd-t-rb", finish_tag: "RB-1", color: "#475569", fill: "#475569", hatch: "horiz", multiplier: 1, waste_pct: 5, extrude_mode: "vertical", extrude_h_ft: 1 / 3, materials: [] },
  { id: "cnd-t-tr", finish_tag: "TR-1", color: "#c96442", fill: "#c96442", hatch: "vert", multiplier: 1, waste_pct: 0, extrude_mode: "flush", thickness_in: 0.25, materials: [] },
  { id: "cnd-t-wt", finish_tag: "WT-1", color: "#2563eb", fill: "#2563eb", hatch: "grid", multiplier: 1, waste_pct: 10, height_ft: 4, materials: [] },
  { id: "cnd-t-cg", finish_tag: "CG-1", color: "#0ea5e9", fill: "#0ea5e9", hatch: "vert", multiplier: 1, waste_pct: 0, extrude_h_ft: 4, materials: [] },
  { id: "cnd-t-ded", finish_tag: "DED-1", color: "#b03a26", fill: "#b03a26", hatch: "cross", multiplier: 1, waste_pct: 0, extrude_h_ft: 3, materials: [] },
  // roll-goods opt-in: roll_setup present = carpet lanes/seams on the 3D slab
  { id: "cnd-t-rc", finish_tag: "RC-1", color: "#8a5a2b", fill: "#8a5a2b", hatch: "speckle", multiplier: 1, waste_pct: 8, materials: [],
    roll_setup: { material: "carpet", roll_width_ft: 12, roll_length_ft: 0, seam_allowance_in: 2, wall_overage_in: 3, doorway_overage_in: 1, direction: "auto", price_unit: "sy" } },
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
  // small single-lane room (11×8 ft, both under the 11.5 ft n=1 cap) — one
  // band, no seam; parity check for the roll-goods lane payload
  mk({ id: "shp-t-rollSingle", condition_id: "cnd-t-rc", measure_role: "floor_area", verts_norm: ROLL_SINGLE,
       computed: { area_sf: 88, perimeter_lf: 38 } }),
  // L-shaped room (30×20 ft envelope, 10×8 ft notch) — multi-lane bands +
  // seams; the notch corner must render unstriped (concave footprint clip)
  mk({ id: "shp-t-rollL", condition_id: "cnd-t-rc", measure_role: "floor_area", verts_norm: ROLL_L,
       computed: { area_sf: 520, perimeter_lf: 116 } }),
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
