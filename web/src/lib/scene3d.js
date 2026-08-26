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
    // ×N never duplicates geometry — note per condition, hoisted ABOVE the
    // role dispatch so every role's `continue` still reaches it (cycle-2 bug).
    if ((c.multiplier || 1) > 1) note("xn", c.finish_tag, `${c.finish_tag}: ×${c.multiplier} applies at condition level`);
    if (s.measure_role === "deduct") {
      if (s.cuts_shape_id) continue; // reconciled: hole already baked into the parent
      const vf = ringCCW(toWorldFt(s.verts_norm, sheet));
      slabs.push({ verts_ft: vf, holes_ft: [], z0: 0, z1: condH, color: EXCLUDED_COLOR, tag: c.finish_tag, kind: "excluded", shapeId: s.id });
      note("excluded", c.finish_tag, "excluded area — see plan", { at: centroid2(vf) });
      continue;
    }
    if (s.measure_role === "surface_area") {
      const h = Number(s.height_ft) > 0 ? Number(s.height_ft) : Number(c.height_ft) || 0;
      ribbons.push({ path_ft: nudgePath(toWorldFt(s.verts_norm, sheet), -RIBBON_HALF_FT / 2), z0: 0, z1: h > 0 ? h : NOMINAL_HEIGHT_FT, side: "center",
        color: c.color, tag: c.finish_tag, mode: "vertical", shapeId: s.id,
        derived: false, translucent: !(h > 0) });
      if (!(h > 0)) note("unset-height", c.finish_tag, `${c.finish_tag} has no height set — shown at nominal`);
      continue;
    }
    if (s.measure_role === "linear") {
      const derived = !!s.origin?.derived;
      if (derived && s.origin.derived.from_shape_id) note("openings", c.finish_tag, "Openings are deducted from LF — door gaps are not shown in 3D");
      if ((c.extrude_mode || "vertical") === "flush") {
        const z0 = flushBase(s, shapes, condById, c, note);
        const t = Number(c.thickness_in) > 0 ? c.thickness_in / 12 : NOMINAL_THICKNESS_FT;
        ribbons.push({ path_ft: toWorldFt(s.verts_norm, sheet), z0, z1: z0 + t, side: "center",
          color: c.color, tag: c.finish_tag, mode: "flush", shapeId: s.id, derived, translucent: false });
      } else {
        const h = extrudeHeight(s, c);
        // Interior inset (spec, Web3D B9): derived rings are the floor's own
        // boundary, so offset them INTO the room by the ribbon half-width or
        // they render coincident with the slab edge. Hand-traced runs center
        // on the path, nudged +half/2 so a base and a wainscot sharing one
        // wall line never share literal world coordinates.
        const rawPath = toWorldFt(s.verts_norm, sheet);
        ribbons.push({ path_ft: derived ? insetRing(rawPath, RIBBON_HALF_FT) : nudgePath(rawPath, RIBBON_HALF_FT / 2),
          z0: 0, z1: h > 0 ? h : NOMINAL_HEIGHT_FT,
          side: derived ? "interior" : "center",
          color: c.color, tag: c.finish_tag, mode: "vertical", shapeId: s.id,
          derived, translucent: !(h > 0) });
        if (!(h > 0)) note("unset-height", c.finish_tag, `${c.finish_tag} has no installed height set — shown at nominal`);
      }
      continue;
    }
    if (s.measure_role === "count") {
      const h = extrudeHeight(s, c);
      posts.push({ pt_ft: toWorldFt(s.verts_norm, sheet)[0], z0: 0, z1: h > 0 ? h : NOMINAL_HEIGHT_FT,
        color: c.color, tag: c.finish_tag, shapeId: s.id, translucent: !(h > 0) });
      if (!(h > 0)) note("unset-height", c.finish_tag, `${c.finish_tag} has no installed height set — shown at nominal`);
    }
  }
  return { slabs, ribbons, posts, notes };
}

// Quad strip along an open path. θ = interior angle at a joint between the
// (prev→vertex) and (vertex→next) rays; miter length = halfWidth / sin(θ/2).
// A near-reversal drives θ→0 and the miter→∞; past MITER_LIMIT × halfWidth the
// joint bevels (each segment keeps its own normal offsets). Near-duplicate
// points collapse and zero-length segments drop BEFORE any normal math.
export function buildRibbon(pathFt, halfWidth) {
  const pts = [];
  for (const p of pathFt) {
    const last = pts[pts.length - 1];
    if (!last || Math.hypot(p[0] - last[0], p[1] - last[1]) > 1e-6) pts.push(p);
  }
  const positions = [];
  if (pts.length < 2) return { positions };
  const segU = (i) => {
    const a = pts[i], b = pts[i + 1];
    const l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    return [(b[0] - a[0]) / l, (b[1] - a[1]) / l];
  };
  const off = (p, n) => [p[0] + n[0] * halfWidth, p[1] + n[1] * halfWidth];
  const leftN = (u) => [u[1], -u[0]];
  // Miter point at vertex i for uIn/uOut, or null to bevel. Valid only when
  // BOTH sides stay within the clamp (one-sided spikes are still spikes).
  const miter = (i, uIn, uOut) => {
    const cosT = -(uIn[0] * uOut[0] + uIn[1] * uOut[1]); // cos θ between the two rays
    const sinHalf = Math.sqrt(Math.max(0, (1 - cosT) / 2));
    if (sinHalf < 1e-6) return null;
    const len = halfWidth / sinHalf;
    if (len > MITER_LIMIT * halfWidth) return null;
    const nIn = leftN(uIn), nOut = leftN(uOut);
    let bx = nIn[0] + nOut[0], by = nIn[1] + nOut[1];
    const bl = Math.hypot(bx, by) || 1; bx /= bl; by /= bl;
    return [pts[i][0] + bx * len, pts[i][1] + by * len];
  };
  // Per-segment end points (x,y pairs), mitered where the joint allows.
  const endPair = (i, u) => {
    const n = leftN(u);
    return [off(pts[i], n), off(pts[i], [-n[0], -n[1]])]; // [left, right]
  };
  for (let i = 0; i < pts.length - 1; i++) {
    const u = segU(i);
    let aL, aR, bL, bR;
    if (i > 0) {
      const m = miter(i, segU(i - 1), u);
      if (m) { aL = m; aR = [2 * pts[i][0] - m[0], 2 * pts[i][1] - m[1]]; } // mirror through the vertex
      else { [aL, aR] = endPair(i, u); }
    } else { [aL, aR] = endPair(0, u); }
    if (i < pts.length - 2) {
      const m = miter(i + 1, u, segU(i + 1));
      if (m) { bL = m; bR = [2 * pts[i + 1][0] - m[0], 2 * pts[i + 1][1] - m[1]]; }
      else { [bL, bR] = endPair(i + 1, u); }
    } else { [bL, bR] = endPair(i + 1, u); }
    positions.push(aL[0], aL[1], bL[0], bL[1], bR[0], bR[1],
                   aL[0], aL[1], bR[0], bR[1], aR[0], aR[1]); // 2 triangles (DoubleSide covers orientation)
  }
  return { positions };
}

const extrudeHeight = (s, c) =>
  s.extrude_override === true ? Number(s.extrude_h_ft) || 0
  : Number(s.extrude_h_ft) > 0 ? Number(s.extrude_h_ft)
  : Number(c.extrude_h_ft) > 0 ? Number(c.extrude_h_ft)
  : 0;

// Higher of the two adjoining slab tops for a derived transition; nominal + note otherwise.
function flushBase(s, shapes, condById, c, note) {
  const ids = s.origin?.derived?.between_shape_ids;
  if (Array.isArray(ids)) {
    let top = 0;
    for (const id of ids) {
      const f = shapes.find((x) => x.id === id && x.measure_role === "floor_area");
      const fc = f && condById.get(f.condition_id);
      if (fc && Number(fc.thickness_in) > 0) top = Math.max(top, fc.thickness_in / 12);
    }
    if (top > 0) return top;
  }
  note("nominal-thickness", c.finish_tag, `${c.finish_tag} has no linked floors — strip sits at nominal`);
  return NOMINAL_THICKNESS_FT;
}

export function centroid2(ring) {
  let x = 0, y = 0;
  for (const p of ring) { x += p[0]; y += p[1]; }
  return [x / ring.length, y / ring.length];
}

// Interior inset for derived base rings: ringCCW-normalized rings are CCW in
// world, so the interior lies LEFT of each directed edge; inward normal =
// rotate the edge direction +90°: n = (−uy, ux). Each vertex moves along the
// bisector of its two adjacent inward edge normals, clamped to the plain edge
// normal when degenerate (reflex corners) — a bounded inset, never a spike.
export function insetRing(ring, dist) {
  const r = ringCCW(ring);
  const n = r.length;
  const inward = (i) => {
    const a = r[i], b = r[(i + 1) % n];
    const l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    return [-(b[1] - a[1]) / l, (b[0] - a[0]) / l];
  };
  return r.map((p, i) => {
    const nPrev = inward((i - 1 + n) % n), nNext = inward(i);
    let bx = nPrev[0] + nNext[0], by = nPrev[1] + nNext[1];
    const bl = Math.hypot(bx, by);
    if (bl < 1e-9) { bx = nNext[0]; by = nNext[1]; } else { bx /= bl; by /= bl; }
    return [p[0] + bx * dist, p[1] + by * dist];
  });
}

// Deterministic lateral nudge so two ribbons sharing one wall line (e.g. a
// hand-traced base + a wainscot trace over the same snapped centerline) never
// occupy identical world coordinates (spec Web3D B9). Offsets every vertex
// along its edge's left normal by delta — sign is the caller's role choice.
export function nudgePath(path, delta) {
  return path.map((p, i) => {
    // The LAST vertex has no next segment — offset along the PRECEDING
    // segment's left normal (cycle-3 bug: with b === p the direction was the
    // zero vector and the endpoint never moved; a 2-point wall run is the
    // common case and must separate at BOTH ends).
    const last = i === path.length - 1;
    const a = last ? path[i - 1] : p;
    const b = last ? p : path[i + 1];
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const l = Math.hypot(dx, dy) || 1;
    return [p[0] + (-dy / l) * delta, p[1] + (dx / l) * delta];
  });
}
