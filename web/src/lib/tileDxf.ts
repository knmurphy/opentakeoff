// web/src/lib/tileDxf.ts
//
// Bridges a shape's solved tile layout (tileTakeoff.js's `layout`, out of
// computeTileTakeoff's byShape map) to dxf.ts's DxfTileCell[] — the same
// installed-face geometry TileOverlay draws on the canvas (tileOverlay.ts:
// installedFace(quad.w, quad.h, joint_ft) at quad.cx/cy/rot), just emitted as
// closed-quad corners in tileTakeoff's ring_ft frame (feet, x right, y down)
// instead of a canvas-space {cx,cy,w,h,rot} rect. Kept classes only
// ("full"/"cut"/"corner") — "hole"/"out" cells carry no installed material
// and dxf.ts would skip them anyway; filtering here keeps the payload small.
import type { DxfTileCell } from "./dxf.ts";
import { installedFace } from "./tilePitch.ts";
import { inToFt } from "./tileUnits.ts";

const KEPT: Record<string, true> = { full: true, cut: true, corner: true };

// One rotated quad's four corners, ring_ft frame — same rotation convention
// as tileGeometry/classify.ts's tileCorners: local (±w/2, ±h/2) rotated by
// quad.rot (radians) about (cx, cy).
function quadCorners(cx: number, cy: number, w: number, h: number, rot: number): [number, number][] {
  const hw = w / 2, hh = h / 2;
  const cos = Math.cos(rot), sin = Math.sin(rot);
  const local: [number, number][] = [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]];
  return local.map(([lx, ly]) => [cx + lx * cos - ly * sin, cy + lx * sin + ly * cos]);
}

// layout = one shape's solved TileLayout (tileSolve.ts): { config, classified, ... }.
export function shapeTileCells(layout: { config: { joint_in: number }; classified: Array<{ cls: string; quad: { cx: number; cy: number; w: number; h: number; rot: number } }> } | null | undefined): DxfTileCell[] {
  if (!layout || !Array.isArray(layout.classified)) return [];
  const joint_ft = inToFt(layout.config.joint_in);
  const out: DxfTileCell[] = [];
  for (const c of layout.classified) {
    if (!KEPT[c.cls]) continue;
    const face = installedFace(c.quad.w, c.quad.h, joint_ft);
    out.push({ cls: c.cls, pts_ft: quadCorners(c.quad.cx, c.quad.cy, face.w, face.h, c.quad.rot) });
  }
  return out;
}
