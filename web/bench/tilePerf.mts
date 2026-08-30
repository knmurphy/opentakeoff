// Tile-engine PERFORMANCE bench — the timing gate `bench/run.mts` never was:
//   npm run bench:tile        (from web/)
// run.mts scores One-Click ACCURACY (IoU/refusal) and asserts nothing about
// wall-clock. The tile pipeline's cost — computeTileTakeoff → summarizeShape →
// effectiveTileSetup → optimizeOrigin (an O(V^2) balanced-origin search) →
// solveTileLayout/classifyLayout — is the pathway that regressed to a 9495ms
// main-thread block before the drag-gate / classify fast-path / solve-reuse
// work landed. Those wins were measured with throwaway one-offs and never
// preserved; this file preserves them as a gate.
//
// WHAT IT MEASURES. Warm median (warmup discarded) wall-clock of
// computeTileTakeoff over a pinned synthetic corpus — a simple rectangle, an
// L, a heavily-jogged comb (the optimizeOrigin candidate stressor), and a
// four-room condition — for grid (balanced → origin search runs) and
// herringbone (origin search skipped). optimizeOrigin is ALSO timed directly
// on the jogged room to isolate the O(V^2) search. Budgets are generous
// (~2.5-3x the measured warm median on an M4) so this catches a real
// regression, not machine jitter. Non-zero exit when a budget is exceeded.
import { computeTileTakeoff } from "../src/lib/tileTakeoff.js";
import { optimizeOrigin } from "../src/lib/tileGeometry/optimize.ts";
import { mintTileSetup, type TilePattern } from "../src/lib/tileSetup.ts";

// Synthetic 50ft x 50ft sheet: 1000x1000 px at 0.05 ft/px.
const DIMS = { w: 1000, h: 1000 };
const UPP = 0.05;
const dimsFor = () => DIMS;
const uppFor = () => UPP;

type Verts = [number, number][];
// rect ~20ft x 30ft = 600 SF, ~300 12x24 tiles.
const RECT: Verts = [[0, 0], [0.4, 0], [0.4, 0.6], [0, 0.6]];
const LSHAPE: Verts = [[0, 0], [0.4, 0], [0.4, 0.3], [0.2, 0.3], [0.2, 0.6], [0, 0.6]];
// Comb: many top-edge teeth → many distinct mod() origin candidates (V=15).
const JOGGED: Verts = [
  [0, 0], [0.4, 0],
  [0.4, 0.6], [0.35, 0.6], [0.35, 0.5], [0.3, 0.5], [0.3, 0.6],
  [0.25, 0.6], [0.25, 0.5], [0.2, 0.5], [0.2, 0.6],
  [0.15, 0.6], [0.15, 0.5], [0.1, 0.6], [0, 0.6],
];

function setup(pattern: TilePattern) {
  const ts = mintTileSetup();
  ts.pattern = pattern;
  ts.edge_strategy = "balanced";
  ts.skus[0].w_in = 12;
  ts.skus[0].h_in = 24;
  ts.joint.width_in = 0.125;
  return ts;
}

function ringFt(verts: Verts): [number, number][] {
  return verts.map(([nx, ny]): [number, number] => [nx * DIMS.w * UPP, ny * DIMS.h * UPP]);
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

// Warm median: one warmup call (JIT + first-solve caches), then N timed.
function timeMs(fn: () => void, n = 7): number {
  fn();
  const runs: number[] = [];
  for (let i = 0; i < n; i++) {
    const t = performance.now();
    fn();
    runs.push(performance.now() - t);
  }
  return median(runs);
}

type Case = { name: string; budgetMs: number; run: () => void };

function takeoffCase(name: string, pattern: TilePattern, rooms: Verts[], budgetMs: number): Case {
  const cond = { id: "c1", finish_tag: "CT-1", multiplier: 1, tile_setup: setup(pattern) };
  const shapes = rooms.map((verts, i) => ({
    id: "s" + i, condition_id: "c1", measure_role: "floor_area", sheet_id: "sh", verts_norm: verts,
  }));
  return { name, budgetMs, run: () => { computeTileTakeoff([cond], shapes, dimsFor, uppFor); } };
}

// The perf #2 win: with a cross-render cache, an edit re-solves only the room
// that changed. Prime a 4-room cache, then each timed call presents a fresh
// geometry for room 0 (a MISS → one re-solve) while rooms 1-3 are byte-
// identical (HITS). If the cache ever stops working, all four re-solve and
// this collapses back toward the un-cached "grid · 4 rooms" cost, tripping the
// budget — that regression is exactly what this case guards.
function cacheEditCase(): Case {
  const cond = { id: "c1", finish_tag: "CT-1", multiplier: 1, tile_setup: setup("grid") };
  const base = [RECT, LSHAPE, RECT, LSHAPE];
  const cache = new Map();
  let k = 0;
  const build = () => {
    const eps = 1 + (k++ % 1000) * 1e-6; // nudge room 0 to a never-seen ring each call
    return base.map((verts, i) => ({
      id: "s" + i, condition_id: "c1", measure_role: "floor_area", sheet_id: "sh",
      verts_norm: i === 0 ? verts.map(([x, y]): [number, number] => [x * eps, y * eps]) : verts,
    }));
  };
  computeTileTakeoff([cond], build(), dimsFor, uppFor, cache); // prime rooms 1-3
  return {
    name: "grid · 4 rooms, cached (1 edit)",
    budgetMs: 90, // ~5x the warm median; a broken cache re-solves all 4 (~130ms) and trips this
    run: () => { computeTileTakeoff([cond], build(), dimsFor, uppFor, cache); },
  };
}

const cases: Case[] = [
  takeoffCase("grid · rectangle", "grid", [RECT], 120),
  takeoffCase("grid · L-shape", "grid", [LSHAPE], 300),
  takeoffCase("grid · jogged comb", "grid", [JOGGED], 650),
  takeoffCase("grid · 4 rooms", "grid", [RECT, LSHAPE, RECT, LSHAPE], 700),
  cacheEditCase(),
  takeoffCase("herringbone · 4 rooms", "herringbone", [RECT, LSHAPE, RECT, LSHAPE], 350),
  {
    name: "optimizeOrigin · jogged comb (grid, balanced)",
    budgetMs: 650,
    run: () => { optimizeOrigin({ tile_setup: setup("grid"), ring_ft: ringFt(JOGGED) }); },
  },
];

const results = cases.map((c) => {
  const ms = timeMs(c.run);
  return { name: c.name, medianMs: Math.round(ms * 10) / 10, budgetMs: c.budgetMs, pass: ms <= c.budgetMs };
});

const wCase = Math.max(...results.map((r) => r.name.length));
for (const r of results) {
  const tag = r.pass ? "ok  " : "FAIL";
  console.log(`${tag} ${r.name.padEnd(wCase)}  ${String(r.medianMs).padStart(7)} ms   (budget ${r.budgetMs} ms)`);
}
console.log("\n" + JSON.stringify({ tilePerf: results }, null, 2));

const failed = results.filter((r) => !r.pass);
if (failed.length) {
  console.error(`\ntile perf bench FAILED: ${failed.map((r) => r.name).join(", ")}`);
  process.exit(1);
}
console.log("\ntile perf bench passed.");
