// web/src/lib/tileCalc/joints.ts
//
// TCNA EJ171 movement joints (design §3.3 `joints`): a soft joint at every
// restraining wall (the room perimeter), an interior field grid every
// ~20-25ft, and any material-transition runs (carpet-meets-tile, etc.). All
// three are linear-feet estimates, dollar-free — the same shape as trim.
//
// field_lf is computed over the room's axis-aligned bounding box rather than
// clipping the grid to the ring itself: on a rectangular room the AABB IS the
// room, so the count is exact; on an irregular ring it over-counts (a field
// line can cross a notch or bay that isn't actually floor). That's an
// accepted approximation for an LF estimate — exact ring-clipping of field
// lines is a refinement, not required here.
import type { Pt } from "../transitions.ts";

export type JointTally = {
  perimeter_lf: number;
  field_lf: number;
  transition_lf: number;
  total_lf: number;
  fieldGridSpacing_ft: number;
};

const DEFAULT_SPACING_FT = 24;
// A field line lands strictly inside the extent — an exact multiple of the
// spacing (e.g. a 24ft room at 24ft spacing) must NOT place a line at the
// far, restraining wall (that joint is already counted in perimeter_lf).
const EPSILON_FT = 1e-6;

function ringPerimeter(ring: Pt[]): number {
  let sum = 0;
  for (let i = 0; i < ring.length; i++) {
    const [ax, ay] = ring[i];
    const [bx, by] = ring[(i + 1) % ring.length];
    sum += Math.hypot(bx - ax, by - ay);
  }
  return sum;
}

function ringAabb(ring: Pt[]): { width: number; height: number } {
  const xs = ring.map(([x]) => x);
  const ys = ring.map(([, y]) => y);
  return { width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) };
}

export function movementJoints(args: {
  ring_ft: Pt[];
  transitions_lf?: number;
  spacing_ft?: number;
}): JointTally {
  const spacing_ft = args.spacing_ft ?? DEFAULT_SPACING_FT;
  const perimeter_lf = ringPerimeter(args.ring_ft);
  const { width, height } = ringAabb(args.ring_ft);
  const vLines = Math.floor((width - EPSILON_FT) / spacing_ft);
  const hLines = Math.floor((height - EPSILON_FT) / spacing_ft);
  const field_lf = vLines * height + hLines * width;
  const transition_lf = args.transitions_lf ?? 0;
  return {
    perimeter_lf,
    field_lf,
    transition_lf,
    total_lf: perimeter_lf + field_lf + transition_lf,
    fieldGridSpacing_ft: spacing_ft,
  };
}
