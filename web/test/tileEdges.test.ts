import { test } from "node:test";
import assert from "node:assert/strict";
import { edgeExposures } from "../src/lib/tileEdges/expose.ts";

// A standalone rectangular room with no neighbors: every edge is exterior-hull
// coincident (nothing nearby), so all 4 edges suggest trim, unconfirmed.
test("edgeExposures: standalone rectangle suggests trim on every edge, unconfirmed", () => {
  const ring: [number, number][] = [[0, 0], [4, 0], [4, 4], [0, 4]];
  const edges = edgeExposures({ ring_ft: ring });
  assert.equal(edges.length, 4);
  for (const e of edges) {
    assert.equal(e.exposure, "trim");
    assert.equal(e.suggested, true);
    assert.equal(e.confirmed, false);
    assert.equal(e.finish_neighbor, undefined);
  }
});

// length_lf must match the geometric edge length.
test("edgeExposures: length_lf matches the ring's geometric edge lengths", () => {
  const ring: [number, number][] = [[0, 0], [4, 0], [4, 4], [0, 4]];
  const edges = edgeExposures({ ring_ft: ring });
  assert.equal(edges[0].length_lf, 4); // (0,0)->(4,0)
  assert.equal(edges[1].length_lf, 4); // (4,0)->(4,4)
  assert.equal(edges[2].length_lf, 4); // (4,4)->(0,4)
  assert.equal(edges[3].length_lf, 4); // (0,4)->(0,0)
});

// An explicit user override wins outright: exposure becomes the override,
// confirmed, no longer merely suggested.
test("edgeExposures: overrides confirm the edge and record user_override", () => {
  const ring: [number, number][] = [[0, 0], [4, 0], [4, 4], [0, 4]];
  const edges = edgeExposures({ ring_ft: ring, overrides: { 0: "bullnose" } });
  assert.equal(edges[0].exposure, "bullnose");
  assert.equal(edges[0].suggested, false);
  assert.equal(edges[0].confirmed, true);
  assert.equal(edges[0].user_override, "bullnose");
  // untouched edges stay the unconfirmed trim suggestion.
  assert.equal(edges[1].exposure, "trim");
  assert.equal(edges[1].confirmed, false);
});

// A neighbor ring separated by a wall-thickness gap: the coincident edge
// (proximate to the neighbor, within the wall-thickness proximity threshold)
// suggests threshold and carries the neighbor's finish_tag. Edges far from
// the neighbor stay trim.
test("edgeExposures: a wall-proximate neighbor suggests threshold with finish_neighbor", () => {
  const ring: [number, number][] = [[0, 0], [4, 0], [4, 4], [0, 4]];
  // Neighbor room sits 0.5ft (a wall thickness) to the right of the shared edge.
  const neighbor = { finish_tag: "carpet-1", ring_ft: [[4.5, 0], [8.5, 0], [8.5, 4], [4.5, 4]] as [number, number][] };
  const edges = edgeExposures({ ring_ft: ring, neighbors: [neighbor] });
  const right = edges[1]; // (4,0)->(4,4), midpoint (4,2), 0.5ft from the neighbor
  assert.equal(right.exposure, "threshold");
  assert.equal(right.suggested, true);
  assert.equal(right.confirmed, false);
  assert.equal(right.finish_neighbor, "carpet-1");
  // the other three edges are far from the neighbor and stay trim.
  assert.equal(edges[0].exposure, "trim");
  assert.equal(edges[2].exposure, "trim");
  assert.equal(edges[3].exposure, "trim");
});
