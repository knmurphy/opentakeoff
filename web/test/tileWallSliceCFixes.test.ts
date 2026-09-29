// web/test/tileWallSliceCFixes.test.ts
//
// Slice C fix pass (2026-09-29) — pins the review findings
// (docs/superpowers/research/2026-09-29-wall-tile-slice-c-review.md):
// I1 coincident vertices, I2 no gap on the sheet, I3 mirror, M2/M3 labels,
// M5 header + real-pipeline coverage. View-side orientation itself is pinned
// by tileWallViewSide.test.ts.
import { test } from "node:test";
import assert from "node:assert/strict";
import { unwrapRun } from "../src/lib/tileWall/unwrap.ts";
import { summarizeWallShape } from "../src/lib/tileWall/index.ts";
import { mintTileSetup } from "../src/lib/tileSetup.ts";
import { wallElevationLayout } from "../src/lib/tileWallElevation.ts";
import { developedElevationLayout, PREVIEW_GAP_FT } from "../src/lib/developedElevation.ts";
import {
  elevationHeader, formatFeetInchesEighths, cornerMarkLabel, staggerRows,
} from "../src/lib/wallElevationPdf.ts";

type Pt = [number, number];
const dims = { w: 100, h: 100 };
const upp = 0.1; // 1 norm unit = 10 ft
const ft = (x: number) => x / 10;
const L_RUN: Pt[] = [[ft(0), ft(0)], [ft(10.5), ft(0)], [ft(10.5), ft(7.5)]];

function setup(mode: "wrap" | "reset" = "wrap") {
  const ts = mintTileSetup();
  ts.skus[0].w_in = 12;
  ts.skus[0].h_in = 12;
  ts.joint.width_in = 0.125;
  ts.wall_corner_mode = mode;
  return ts;
}

function summarize(verts: Pt[], mode: "wrap" | "reset" = "wrap") {
  const s = summarizeWallShape(setup(mode), { verts_norm: verts, face_side: "left" }, dims, upp, 8);
  assert.notEqual((s as { ok?: false }).ok, false, "expected a real summary");
  return s as Exclude<typeof s, { ok: false }>;
}

// ── I1: coincident vertices ────────────────────────────────────────────────

test("I1: a doubled corner vertex unwraps to ONE inside fold, not an empty wall between two outside folds", () => {
  const doubled: Pt[] = [L_RUN[0], L_RUN[1], L_RUN[1], L_RUN[2]];
  const r = unwrapRun({ verts_norm: doubled, dims, upp, H_ft: 8, face_side: "left" })!;
  assert.equal(r.folds.length, 1);
  assert.equal(r.folds[0].kind, "inside");
  assert.ok(Math.abs(r.folds[0].u_ft - 10.5) < 1e-9);
  assert.equal(r.folds[0].vertexIndex, 1, "keeps the FIRST raw index of the coincident pair");
  assert.ok(Math.abs(r.L_ft - 18) < 1e-9);
});

test("I1: a doubled first or last vertex adds no fold", () => {
  for (const v of [[L_RUN[0], ...L_RUN], [...L_RUN, L_RUN[2]]] as Pt[][]) {
    const r = unwrapRun({ verts_norm: v, dims, upp, H_ft: 8, face_side: "left" })!;
    assert.equal(r.folds.length, 1);
    assert.equal(r.folds[0].kind, "inside");
  }
});

test("I1: a run whose vertices all coincide has nothing to tile", () => {
  assert.equal(unwrapRun({ verts_norm: [L_RUN[0], L_RUN[0], L_RUN[0]], dims, upp, H_ft: 8, face_side: "left" }), null);
});

test("I1: a doubled corner summarizes exactly like the clean run (Slice A counts are not skewed)", () => {
  for (const mode of ["wrap", "reset"] as const) {
    const clean = summarize(L_RUN, mode);
    const doubled = summarize([L_RUN[0], L_RUN[1], L_RUN[1], L_RUN[2]], mode);
    assert.deepEqual(doubled.counts, clean.counts, `${mode}: counts`);
    assert.deepEqual(doubled.folds.map((f) => [f.u_ft, f.kind]), clean.folds.map((f) => [f.u_ft, f.kind]), `${mode}: folds`);
    assert.equal(doubled.wallStrips.length, clean.wallStrips.length, `${mode}: strip count`);
  }
});

test("I1 (defensive): developedElevationLayout drops a fold that does not advance or sits on the run end", () => {
  const tiles = [{ x: 0, y: 0, w: 18, h: 1, cls: "full", color: "#000" }];
  const dev = developedElevationLayout({
    tiles, foldsU: [10.5, 10.5, 18], foldKinds: ["inside", "outside", "outside"], width_ft: 18, height_ft: 1, gap_ft: 0,
  });
  assert.deepEqual(dev.panels.map((p) => p.segWidth_ft), [10.5, 7.5]);
  assert.deepEqual(dev.breaks.map((b) => b.kind), ["inside"]);
});

// ── Real pipeline through the developed layout (M5) ────────────────────────

for (const mode of ["wrap", "reset"] as const) {
  test(`M5: real ${mode} L-run (fold at u=10.5) → two panels, pieces in range, area conserved`, () => {
    const s = summarize(L_RUN, mode);
    const elev = wallElevationLayout(s.wallStrips, s.folds, () => "#000");
    for (const gap_ft of [0, PREVIEW_GAP_FT]) {
      const dev = developedElevationLayout({
        tiles: elev.tiles, foldsU: elev.folds.map((f) => f.x), foldKinds: elev.folds.map((f) => f.kind),
        width_ft: elev.width_ft, height_ft: elev.height_ft, gap_ft,
      });
      assert.deepEqual(dev.panels.map((p) => +p.segWidth_ft.toFixed(9)), [10.5, 7.5]);
      assert.ok(Math.abs(dev.total_width_ft - (18 + gap_ft)) < 1e-9);
      let area = 0;
      for (const p of dev.panels) for (const t of p.tiles) {
        assert.ok(t.x >= -1e-9 && t.x + t.w <= p.segWidth_ft + 1e-9, "panel-local piece in range");
        area += t.w * t.h;
      }
      const elevArea = elev.tiles.reduce((a, t) => a + t.w * t.h, 0);
      assert.ok(Math.abs(area - elevArea) < 1e-9, `area conserved (${area} vs ${elevArea})`);
    }
  });
}

// ── I3: mirror ─────────────────────────────────────────────────────────────

test("I3: mirror flips positions, keeps plan-keyed labels, conserves every piece", () => {
  const s = summarize(L_RUN);
  const elev = wallElevationLayout(s.wallStrips, s.folds, () => "#000");
  const base = {
    tiles: elev.tiles, foldsU: elev.folds.map((f) => f.x), foldKinds: elev.folds.map((f) => f.kind),
    width_ft: elev.width_ft, height_ft: elev.height_ft, gap_ft: 0,
  };
  const plain = developedElevationLayout(base);
  const mirrored = developedElevationLayout({ ...base, mirror: true });
  assert.deepEqual(mirrored.panels.map((p) => p.label), ["Wall 1", "Wall 2"], "labels stay tied to trace order");
  assert.ok(Math.abs(mirrored.panels[0].xOffset - 7.5) < 1e-9, "Wall 1 (10.5 ft) now starts after Wall 2 (7.5 ft)");
  assert.ok(Math.abs(mirrored.panels[1].xOffset - 0) < 1e-9);
  assert.ok(Math.abs(mirrored.breaks[0].x - 7.5) < 1e-9, "the corner sits at 18 − 10.5");
  // every piece maps to its mirror image across the run
  for (const [k, p] of plain.panels.entries()) {
    const m = mirrored.panels[k];
    const a = p.tiles.map((t) => +(p.xOffset + t.x).toFixed(6)).sort((x, y) => x - y);
    const b = m.tiles.map((t) => +(18 - (m.xOffset + t.x + t.w)).toFixed(6)).sort((x, y) => x - y);
    assert.deepEqual(b, a);
  }
});

// ── M2/M3/M5: text ─────────────────────────────────────────────────────────

test("M5: the header states the physical run length, to the 1/8 inch", () => {
  assert.equal(elevationHeader("WT-1", 18, 7.75), `WT-1 — 18'-0" × 7'-9" elevation`);
  assert.equal(elevationHeader("WT-1", 12.53125, 8), `WT-1 — 12'-6 3/8" × 8'-0" elevation`);
});

test("M2: feet-inches to the nearest 1/8 inch, reduced, with exact carries", () => {
  assert.equal(formatFeetInchesEighths(10.5), `10'-6"`);
  assert.equal(formatFeetInchesEighths(10.5 + 1 / 96), `10'-6 1/8"`);
  assert.equal(formatFeetInchesEighths(10.5 + 4 / 96), `10'-6 1/2"`);
  assert.equal(formatFeetInchesEighths(11.999), `12'-0"`);
  assert.equal(formatFeetInchesEighths(0), `0'-0"`);
});

test("M3: corner marks say what they are", () => {
  assert.equal(cornerMarkLabel("inside"), "INSIDE CORNER");
  assert.equal(cornerMarkLabel("outside"), "OUTSIDE CORNER");
});

test("M3: marks that would overprint go to the second row; clear ones stay on the first", () => {
  assert.deepEqual(staggerRows([0, 100, 200], [50, 50, 50]), [0, 0, 0]);
  assert.deepEqual(staggerRows([0, 10, 100], [50, 50, 50]), [0, 1, 0]);
  assert.deepEqual(staggerRows([0, 10, 20], [50, 50, 50]), [0, 1, 1]);
});
