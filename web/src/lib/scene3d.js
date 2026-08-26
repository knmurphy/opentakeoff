// Pure 3D scene builder — no three import, node:test-able. Doctrine:
// docs/superpowers/specs/2026-08-26-3d-takeoff-view-design.md.
// World mapping (pinned): [x_ft, height_up, −y_ft]. Image y grows DOWN; the
// single-axis flip inverts winding, so closed rings are normalized on import
// (ringCCW outer / ringCW holes). The renderer draws DoubleSide as insurance.

export const NOMINAL_THICKNESS_FT = 1 / 24; // floor slab visual thickness — display constant, not user data
export const NOMINAL_HEIGHT_FT = 3;         // unset post/ribbon HEIGHT nominal (tall dimension; never borrow the thickness nominal)
export const EXCLUDED_COLOR = "#b03a26";    // ui.js SVG.danger literal
export const MITER_LIMIT = 4;               // miter offset × ribbon half-width before bevel fallback
export const RIBBON_HALF_FT = 1 / 24;       // vertical ribbon half-width
export const FLUSH_HALF_FT = 1 / 12;        // flush strip half-width

export function toWorldFt(verts_norm, sheet) {
  // `|| 0` folds IEEE-754 −0 to +0 — ny === 0 otherwise yields −0, which
  // assert/strict deepEqual (SameValue) distinguishes from 0 and fails tests.
  return verts_norm.map(([nx, ny]) => [nx * sheet.widthPx * sheet.upp, -(ny * sheet.heightPx * sheet.upp) || 0]);
}

export function worldWindingCCW(ring) {
  let a = 0;
  for (let i = 0; i < ring.length; i++) {
    const [x1, y1] = ring[i], [x2, y2] = ring[(i + 1) % ring.length];
    a += x1 * y2 - x2 * y1;
  }
  return a > 0;
}

export const ringCCW = (ring) => (worldWindingCCW(ring) ? ring : [...ring].reverse());
export const ringCW = (ring) => (worldWindingCCW(ring) ? [...ring].reverse() : ring);

export function buildScene({ shapes, conditions, sheet }) {
  if (!(sheet.upp > 0)) throw new Error("Set the sheet scale first — 3D is feet-true or nothing.");
  const condById = new Map(conditions.map((c) => [c.id, c]));
  const slabs = [], ribbons = [], posts = [], notes = [];
  const noted = new Set(); // one note per (kind, tag)
  const note = (kind, tag, text, extra = {}) => {
    const key = `${kind}:${tag}`;
    if (noted.has(key)) return;
    noted.add(key);
    notes.push({ kind, tag, text, ...extra });
  };

  for (const s of shapes) {
    const c = condById.get(s.condition_id);
    if (!c) continue; // orphan on dead condition — totals' convention
    const condH = Number(c.thickness_in) > 0 ? c.thickness_in / 12 : NOMINAL_THICKNESS_FT;

    if (s.measure_role === "floor_area") {
      slabs.push({
        verts_ft: ringCCW(toWorldFt(s.verts_norm, sheet)),
        holes_ft: (s.verts_norm_holes || []).map((h) => ringCW(toWorldFt(h, sheet))),
        z0: 0, z1: condH, color: c.color, tag: c.finish_tag, kind: "floor", shapeId: s.id,
      });
      if (!(Number(c.thickness_in) > 0)) note("nominal-thickness", c.finish_tag, `${c.finish_tag} has no thickness set — slab shown at nominal visual thickness`);
    }
    // surface_area / linear / count / deduct: Task 2
  }
  return { slabs, ribbons, posts, notes };
}
