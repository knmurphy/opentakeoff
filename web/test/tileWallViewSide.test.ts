// web/test/tileWallViewSide.test.ts
//
// Slice C review I3 — which way does the elevation read? An elevation is drawn
// as seen by someone STANDING IN FRONT OF THE TILED FACE: the wall end on their
// left is at the sheet's left. The pipeline always draws u (distance along the
// run, from verts_norm[0]) left→right, so that only holds when the drawn run
// direction points to the viewer's right.
//
// The oracle below derives the viewer's right from first principles, NOT from
// unwrap.ts: face_side "left" = the tiled face lies on the (-dy, dx) side of the
// drawn direction in raw verts_norm coords (unwrap.ts CONVENTION). verts_norm is
// y-DOWN (screen), so we convert to a y-up world frame, face the wall (look along
// -normal), and turn that facing 90° clockwise to get the viewer's right.
//
// The fixture is ONE physical L of wall traced two ways: the same tiled face
// (inside of the L), so the correct drawing must be identical either way.
import { test } from "node:test";
import assert from "node:assert/strict";
import { summarizeWallShape } from "../src/lib/tileWall/index.ts";
import { mintTileSetup } from "../src/lib/tileSetup.ts";
import { wallElevationLayout } from "../src/lib/tileWallElevation.ts";
import { developedElevationLayout } from "../src/lib/developedElevation.ts";

type Pt = [number, number];
const dims = { w: 100, h: 100 };
const upp = 0.1; // 1 norm unit = 10 ft
const ft = (x: number) => x / 10;

function setup() {
  const ts = mintTileSetup();
  ts.skus[0].w_in = 12;
  ts.skus[0].h_in = 12;
  ts.joint.width_in = 0;
  return ts;
}

// Viewer's right for one straight segment, in the same y-down frame as verts.
function viewerRight(a: Pt, b: Pt, face: "left" | "right"): Pt {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const s = face === "left" ? 1 : -1;
  const n: Pt = [-dy * s, dx * s];              // face normal, y-down
  const fWorld: Pt = [-n[0], n[1]];             // facing = -normal, converted to y-up (negate y)
  const rWorld: Pt = [fWorld[1], -fWorld[0]];   // 90° clockwise in y-up
  return [rWorld[0], -rWorld[1]];               // back to y-down
}

// The developed layout the panel and the sheet both draw from.
function drawnPanels(verts: Pt[], face: "left" | "right") {
  const s = summarizeWallShape(setup(), { verts_norm: verts, face_side: face }, dims, upp, 8);
  assert.notEqual((s as { ok?: false }).ok, false, "expected a real summary");
  const sum = s as Exclude<typeof s, { ok: false }>;
  const elev = wallElevationLayout(sum.wallStrips, sum.folds, (id: string) => `#${id}`);
  const dev = developedElevationLayout({
    tiles: elev.tiles, foldsU: elev.folds.map((f) => f.x), foldKinds: elev.folds.map((f) => f.kind),
    width_ft: elev.width_ft, height_ft: elev.height_ft,
  });
  return [...dev.panels].sort((p, q) => p.xOffset - q.xOffset);
}

// Physical wall: a 10.5 ft leg (N wall) and a 7.5 ft leg (E wall) meeting at an
// inside corner; tile on the inside. Standing inside facing the corner, the
// 10.5 ft wall is on your LEFT and the 7.5 ft wall on your RIGHT.
const A: Pt[] = [[ft(0), ft(0)], [ft(10.5), ft(0)], [ft(10.5), ft(7.5)]];   // traced from the N wall's far end
const B: Pt[] = [...A].reverse() as Pt[];                                    // traced from the E wall's far end
const traces = [
  { name: "trace A (face_side left)", verts: A, face: "left" as const },
  { name: "trace B (face_side right)", verts: B, face: "right" as const },
];

test("oracle sanity: both traces put the tile on the SAME physical face, and it is the inside of the L", () => {
  // inside of the L = south of the N wall, west of the E wall (y-down)
  const [a0, a1] = A;
  const nA = [-(a1[1] - a0[1]), a1[0] - a0[0]];           // face_side left normal on the N wall
  assert.ok(nA[1] > 0, "trace A: face is south (+y, y-down) of the N wall");
  const [b0, b1] = B;
  const nB = [(b1[1] - b0[1]), -(b1[0] - b0[0])];         // face_side right normal on the E wall (−(−dy,dx))
  assert.ok(nB[0] < 0, "trace B: face is west (−x) of the E wall");
});

for (const t of traces) {
  const firstRight = viewerRight(t.verts[0], t.verts[1], t.face);
  const firstDir: Pt = [t.verts[1][0] - t.verts[0][0], t.verts[1][1] - t.verts[0][1]];
  const runPointsRight = firstDir[0] * firstRight[0] + firstDir[1] * firstRight[1] > 0;

  test(`${t.name}: oracle — the run direction ${runPointsRight ? "points to" : "points AWAY from"} the viewer's right`, () => {
    // pins the math this suite's expectation rests on
    assert.equal(runPointsRight, t.face === "left");
  });

  test(`${t.name}: the 10.5 ft wall is drawn on the LEFT, the 7.5 ft wall on the RIGHT (as seen facing the tile)`, {
    todo: t.face === "right" ? "Slice C review I3: face_side \"right\" draws mirrored — the fix pass flips it" : undefined,
  }, () => {
    const panels = drawnPanels(t.verts, t.face);
    assert.equal(panels.length, 2);
    assert.ok(Math.abs(panels[0].segWidth_ft - 10.5) < 1e-6, `leftmost panel should be the 10.5 ft wall (got ${panels[0].segWidth_ft})`);
    assert.ok(Math.abs(panels[1].segWidth_ft - 7.5) < 1e-6, `rightmost panel should be the 7.5 ft wall (got ${panels[1].segWidth_ft})`);
  });
}
