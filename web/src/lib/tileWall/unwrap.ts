import { openLen } from "../geometry.js";

export type Fold = { u_ft: number; kind: "inside" | "outside"; vertexIndex: number };
export type UnwrapResult = {
  L_ft: number; strip_ring: [number, number][]; folds: Fold[]; warnings: string[];
};

const EPS = 1e-6;

export function wallStripRing(L_ft: number, H_ft: number): [number, number][] {
  return [[0, 0], [L_ft, 0], [L_ft, H_ft], [0, H_ft]];
}

// verts in feet: nx*dims.w*upp
function toFeet(verts_norm: [number, number][], dims: { w: number; h: number }, upp: number): [number, number][] {
  return verts_norm.map(([nx, ny]) => [nx * dims.w * upp, ny * dims.h * upp]);
}

// drop consecutive vertices whose incoming/outgoing edges are collinear (cross≈0, same dir)
function collapseCollinear(pts: [number, number][]): { pts: [number, number][]; keptIndex: number[] } {
  if (pts.length <= 2) return { pts, keptIndex: pts.map((_, i) => i) };
  const out: [number, number][] = [pts[0]]; const keptIndex = [0];
  for (let i = 1; i < pts.length - 1; i++) {
    const [ax, ay] = pts[i - 1], [bx, by] = pts[i], [cx, cy] = pts[i + 1];
    const inx = bx - ax, iny = by - ay, outx = cx - bx, outy = cy - by;
    const cross = inx * outy - iny * outx;
    const dot = inx * outx + iny * outy;
    if (Math.abs(cross) < EPS && dot > 0) continue; // straight-through → drop
    out.push(pts[i]); keptIndex.push(i);
  }
  out.push(pts[pts.length - 1]); keptIndex.push(pts.length - 1);
  return { pts: out, keptIndex };
}

export function unwrapRun(args: {
  verts_norm: [number, number][]; dims: { w: number; h: number }; upp: number;
  H_ft: number; face_side: "left" | "right";
}): UnwrapResult | null {
  const { verts_norm, dims, upp, H_ft, face_side } = args;
  if (!Array.isArray(verts_norm) || verts_norm.length < 2) return null;
  const rawFeet = toFeet(verts_norm, dims, upp);
  const { pts, keptIndex } = collapseCollinear(rawFeet);
  const warnings: string[] = [];

  // reversal (U-turn) detection: antiparallel adjacent edges (cross≈0, dot<0)
  for (let i = 1; i < pts.length - 1; i++) {
    const [ax, ay] = pts[i - 1], [bx, by] = pts[i], [cx, cy] = pts[i + 1];
    const inx = bx - ax, iny = by - ay, outx = cx - bx, outy = cy - by;
    const cross = inx * outy - iny * outx, dot = inx * outx + iny * outy;
    if (Math.abs(cross) < EPS && dot < 0) {
      return null; // caller surfaces "split this reversing run into separate walls"
    }
  }

  const L_ft = openLen(pts) * 1; // pts already in feet
  const folds: Fold[] = [];
  let cum = 0;
  const faceSign = face_side === "left" ? 1 : -1;
  for (let i = 1; i < pts.length - 1; i++) {
    const [ax, ay] = pts[i - 1], [bx, by] = pts[i], [cx, cy] = pts[i + 1];
    cum += Math.hypot(bx - ax, by - ay);
    const inx = bx - ax, iny = by - ay, outx = cx - bx, outy = cy - by;
    const cross = inx * outy - iny * outx;
    // CONVENTION (settled — do not hand-wave): face_side "left" = the tiled face lies on the
    // (-dy, dx) side of the drawn direction, in the RAW verts_norm coords. For an eastward wall
    // dir=(1,0), that face side is +y. "inside" = the corner turns TOWARD the tiled face.
    // Worked: east→south L-run [0,0]→[10.5,0]→[10.5,7.5], out=(0,+1), cross=+1; face left
    // (faceSign +1) → inside. Flip face_side → faceSign -1 inverts every label.
    const kind: "inside" | "outside" = (cross * faceSign) > 0 ? "inside" : "outside";
    folds.push({ u_ft: cum, kind, vertexIndex: keptIndex[i] });
  }
  return { L_ft, strip_ring: wallStripRing(L_ft, H_ft), folds, warnings };
}
