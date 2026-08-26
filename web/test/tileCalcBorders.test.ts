import { test } from "node:test";
import assert from "node:assert/strict";
import { trimTallies, cornerTallies } from "../src/lib/tileCalc/borders.ts";
import { edgeExposures } from "../src/lib/tileEdges/expose.ts";
import type { EdgeExposure } from "../src/lib/tileEdges/expose.ts";

// A rectangle with all 4 edges confirmed trim, piece_lf from a 24in tile
// (2ft): trim LF sums to the perimeter, pieces = ceil(perimeter/2), and every
// vertex is convex (a rectangle has no reflex corner) → 4 outside, 0 inside.
test("trimTallies + cornerTallies: rectangle, all edges trim", () => {
  const ring: [number, number][] = [[0, 0], [6, 0], [6, 4], [0, 4]];
  const exposures = edgeExposures({
    ring_ft: ring,
    overrides: { 0: "trim", 1: "trim", 2: "trim", 3: "trim" },
  });

  const tallies = trimTallies(exposures, { piece_lf: 2 });
  assert.deepEqual(tallies, [{ exposure: "trim", length_lf: 20, pieces: 10 }]);

  const corners = cornerTallies(ring, exposures);
  assert.deepEqual(corners, { outside: 4, inside: 0 });
});

// An L-shaped room (one reflex vertex where the notch cuts in) with every
// edge trimmed: 5 convex corners, 1 reflex corner.
test("cornerTallies: L-shaped room has one reflex corner", () => {
  const ring: [number, number][] = [
    [0, 0], [6, 0], [6, 3], [3, 3], [3, 6], [0, 6],
  ];
  const exposures = edgeExposures({
    ring_ft: ring,
    overrides: { 0: "trim", 1: "trim", 2: "trim", 3: "trim", 4: "trim", 5: "trim" },
  });

  const corners = cornerTallies(ring, exposures);
  assert.deepEqual(corners, { outside: 5, inside: 1 });
});

// A field-only room (no trim/bullnose/cove/threshold anywhere): empty
// tallies, no corners — a field/field vertex carries no border piece.
test("trimTallies + cornerTallies: field-only room is empty", () => {
  const ring: [number, number][] = [[0, 0], [6, 0], [6, 4], [0, 4]];
  const exposures: EdgeExposure[] = ring.map((_, i) => ({
    shapeEdgeIndex: i,
    length_lf: 5,
    exposure: "field",
    suggested: false,
    confirmed: true,
  }));

  assert.deepEqual(trimTallies(exposures, { piece_lf: 2 }), []);
  assert.deepEqual(cornerTallies(ring, exposures), { outside: 0, inside: 0 });
});

// includeSuggested pulls in unconfirmed suggestions too (a standalone
// rectangle with no overrides suggests trim on every edge, unconfirmed).
test("trimTallies: includeSuggested tallies unconfirmed suggestions", () => {
  const ring: [number, number][] = [[0, 0], [6, 0], [6, 4], [0, 4]];
  const exposures = edgeExposures({ ring_ft: ring });

  assert.deepEqual(trimTallies(exposures, { piece_lf: 2 }), []);
  const withSuggested = trimTallies(exposures, { piece_lf: 2, includeSuggested: true });
  assert.deepEqual(withSuggested, [{ exposure: "trim", length_lf: 20, pieces: 10 }]);
});

// cornerTallies must gate on confirmed exposure exactly like trimTallies
// (M4 review): a standalone rectangle with no overrides has 4 SUGGESTED,
// UNCONFIRMED trim edges — corner EA must stay empty by default so a
// bid-line bridge never sees confirmed corners paired with unconfirmed LF.
test("cornerTallies: gates on confirmed exposure like trimTallies", () => {
  const ring: [number, number][] = [[0, 0], [6, 0], [6, 4], [0, 4]];

  const suggested = edgeExposures({ ring_ft: ring });
  assert.deepEqual(trimTallies(suggested), []);
  assert.deepEqual(cornerTallies(ring, suggested), { outside: 0, inside: 0 });
  assert.deepEqual(cornerTallies(ring, suggested, { includeSuggested: true }), {
    outside: 4,
    inside: 0,
  });

  const confirmed = edgeExposures({
    ring_ft: ring,
    overrides: { 0: "trim", 1: "trim", 2: "trim", 3: "trim" },
  });
  assert.deepEqual(cornerTallies(ring, confirmed), { outside: 4, inside: 0 });
});

// finish_neighbor is preserved on a tally only when every edge in the group
// shares the same neighbor (e.g. a run of threshold edges against one carpet
// room).
test("trimTallies: preserves a shared finish_neighbor, drops a mixed one", () => {
  const shared: EdgeExposure[] = [
    { shapeEdgeIndex: 0, length_lf: 3, exposure: "threshold", finish_neighbor: "carpet-1", suggested: false, confirmed: true },
    { shapeEdgeIndex: 1, length_lf: 2, exposure: "threshold", finish_neighbor: "carpet-1", suggested: false, confirmed: true },
  ];
  assert.deepEqual(trimTallies(shared, { piece_lf: 1 }), [
    { exposure: "threshold", length_lf: 5, pieces: 5, finish_neighbor: "carpet-1" },
  ]);

  const mixed: EdgeExposure[] = [
    { shapeEdgeIndex: 0, length_lf: 3, exposure: "threshold", finish_neighbor: "carpet-1", suggested: false, confirmed: true },
    { shapeEdgeIndex: 1, length_lf: 2, exposure: "threshold", finish_neighbor: "vct-2", suggested: false, confirmed: true },
  ];
  assert.deepEqual(trimTallies(mixed, { piece_lf: 1 }), [
    { exposure: "threshold", length_lf: 5, pieces: 5 },
  ]);
});
