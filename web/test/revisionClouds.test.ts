// Auto-flag cloud placement — the per-shape id diff (lib/revisionClouds.js).
// Unlike revisions.js (quantity totals, id-agnostic), this pairs INDIVIDUAL
// shapes by id — valid only for a baseline/current pair on the SAME sheet_id
// where nothing re-imported in between (the resheet-transfer workflow).
import { test } from "node:test";
import assert from "node:assert/strict";
import { diffShapesForCloud } from "../src/lib/revisionClouds.js";

const shape = (over: Record<string, unknown> = {}) => ({
  id: "s1", sheet_id: "b.pdf#1", condition_id: "c1",
  verts_norm: [[0.1, 0.1], [0.3, 0.1], [0.3, 0.3]],
  computed: { area_sf: 100, perimeter_lf: 40 },
  ...over,
});
const tagOf = (id: string) => (id === "c1" ? "CPT-1" : id === "c2" ? "LVT-2" : undefined);

test("unchanged shape (identical verts + computed) produces no cloud", () => {
  const s = shape();
  const clouds = diffShapesForCloud([s], [s], "b.pdf#1", tagOf);
  assert.deepEqual(clouds, []);
});

test("sub-threshold computed wobble with identical verts produces no cloud", () => {
  const base = shape({ computed: { area_sf: 100, perimeter_lf: 40 } });
  const cur = shape({ computed: { area_sf: 100.02, perimeter_lf: 40 } });   // below the 0.05 SF display threshold
  const clouds = diffShapesForCloud([base], [cur], "b.pdf#1", tagOf);
  assert.deepEqual(clouds, []);
});

test("added shape (id only in current) → one 'Added' cloud, bbox from current's verts", () => {
  const cur = shape({ id: "s2", verts_norm: [[0.4, 0.4], [0.6, 0.4], [0.6, 0.6]], computed: { area_sf: 42 } });
  const clouds = diffShapesForCloud([], [cur], "b.pdf#1", tagOf);
  assert.equal(clouds.length, 1);
  assert.equal(clouds[0].type, "cloud");
  assert.equal(clouds[0].sheet_id, "b.pdf#1");
  assert.deepEqual(clouds[0].rect, [[0.385, 0.385], [0.615, 0.615]]);   // bbox padded 0.015 for a clickable gap
  assert.match(clouds[0].text, /^Added — CPT-1/);
  assert.match(clouds[0].text, /\+42\.0 SF/);
});

test("removed shape (id only in baseline) → one 'Removed' cloud, bbox from baseline's verts, clamped to the sheet", () => {
  const base = shape({ id: "s3", verts_norm: [[0.0, 0.0], [0.2, 0.0], [0.2, 0.2]], computed: { area_sf: 30 } });
  const clouds = diffShapesForCloud([base], [], "b.pdf#1", tagOf);
  assert.equal(clouds.length, 1);
  assert.deepEqual(clouds[0].rect, [[0, 0], [0.215, 0.215]]);   // padding at the sheet edge clamps to 0, not negative
  assert.match(clouds[0].text, /^Removed — CPT-1/);
  assert.match(clouds[0].text, /−30\.0 SF/);
});

test("changed shape (verts moved) → one 'Changed' cloud, bbox unions both versions", () => {
  const base = shape({ verts_norm: [[0.1, 0.1], [0.3, 0.1], [0.3, 0.3]], computed: { area_sf: 100 } });
  const cur = shape({ verts_norm: [[0.1, 0.1], [0.5, 0.1], [0.5, 0.3]], computed: { area_sf: 150 } });
  const clouds = diffShapesForCloud([base], [cur], "b.pdf#1", tagOf);
  assert.equal(clouds.length, 1);
  assert.deepEqual(clouds[0].rect, [[0.085, 0.085], [0.515, 0.315]]);
  assert.match(clouds[0].text, /^Changed — CPT-1/);
  assert.match(clouds[0].text, /\+50\.0 SF/);
});

test("changed shape via quantity only (verts identical, computed moved — e.g. a rescale) still flags", () => {
  const base = shape({ computed: { area_sf: 100, perimeter_lf: 40 } });
  const cur = shape({ computed: { area_sf: 120, perimeter_lf: 44 } });
  const clouds = diffShapesForCloud([base], [cur], "b.pdf#1", tagOf);
  assert.equal(clouds.length, 1);
  assert.ok(!("status" in clouds[0]), "no status field leaks into the markup shape");
  assert.match(clouds[0].text, /\+20\.0 SF, \+4\.0 LF/);
});

test("only shapes on the requested sheetId are considered — a matching id on another sheet is ignored", () => {
  const base = shape({ sheet_id: "a.pdf#1" });
  const cur = shape({ sheet_id: "a.pdf#1", computed: { area_sf: 200, perimeter_lf: 40 } });
  const clouds = diffShapesForCloud([base], [cur], "b.pdf#1", tagOf);
  assert.deepEqual(clouds, []);
});

test("EA (count) delta below 0.5 does not flag; at/above 0.5 does", () => {
  const eaShape = (over: Record<string, unknown> = {}) => shape({ measure_role: "count", computed: { count: 1 }, ...over });
  const noFlag = diffShapesForCloud([eaShape()], [eaShape({ computed: { count: 1 } })], "b.pdf#1", tagOf);
  assert.deepEqual(noFlag, []);
  const flag = diffShapesForCloud([eaShape()], [eaShape({ computed: { count: 2 } })], "b.pdf#1", tagOf);
  assert.equal(flag.length, 1);
  assert.match(flag[0].text, /\+1 EA/);
});

test("unknown condition_id falls back to '?' in the label rather than throwing", () => {
  const cur = shape({ id: "s9", condition_id: "missing", computed: { area_sf: 10 } });
  const clouds = diffShapesForCloud([], [cur], "b.pdf#1", tagOf);
  assert.match(clouds[0].text, /^Added — \?/);
});

test("zero id overlap with shapes on both sides is skipped, not flooded with Added+Removed clouds", () => {
  // Auto-flag run against a baseline that ISN'T a transfer baseline (or one
  // that predates a re-import) — same sheet, independently-traced shapes,
  // no shared ids. Every id-based pairing would fail, so this must skip
  // rather than report every shape as simultaneously removed and added.
  const base = shape({ id: "old-1" });
  const cur = shape({ id: "new-1" });
  assert.deepEqual(diffShapesForCloud([base], [cur], "b.pdf#1", tagOf), []);
});

test("a genuinely new sheet (nothing in baseline) still diffs normally — the zero-overlap guard doesn't suppress it", () => {
  const cur = shape({ id: "s1" });
  const clouds = diffShapesForCloud([], [cur], "b.pdf#1", tagOf);
  assert.equal(clouds.length, 1);
  assert.match(clouds[0].text, /^Added/);
});

test("a sheet emptied entirely (nothing in current) still diffs normally — the zero-overlap guard doesn't suppress it", () => {
  const base = shape({ id: "s1" });
  const clouds = diffShapesForCloud([base], [], "b.pdf#1", tagOf);
  assert.equal(clouds.length, 1);
  assert.match(clouds[0].text, /^Removed/);
});
