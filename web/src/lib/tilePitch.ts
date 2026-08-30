// web/src/lib/tilePitch.ts
// The layout contract — one cell, three views (design §3.0). Grout never
// lives inside a pattern generator; the pitch↔face conversion lives here so
// the DRAWN field and the ORDERED quantity cannot drift. All feet.

export type Cell = { w: number; h: number };

export function nominalQuad(w: number, h: number): Cell {
  return { w, h };
}

export function pitchCell(w: number, h: number, j: number): Cell {
  return { w: w + j, h: h + j };
}

// One inset value shared by classification and rendering. Clamped so a fat
// joint relative to a tiny tile can never invert the face.
export function faceInset(w: number, h: number, j: number, eps = 0): number {
  const want = Math.max(j / 2, eps * Math.min(w, h));
  return Math.min(want, 0.49 * Math.min(w, h));
}

export function installedFace(w: number, h: number, j: number, eps = 0): Cell {
  const inset = faceInset(w, h, j, eps);
  return { w: w - 2 * inset, h: h - 2 * inset };
}
