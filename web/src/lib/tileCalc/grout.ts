// web/src/lib/tileCalc/grout.ts
//
// Grout bags derived from the layout's tile geometry (design §3.3), not a
// lumped SF constant: the coverage.js formula's (L+W)/(L·W) term IS
// joint-length-per-SF, so bags scale with the actual tile/joint dims.
import { groutCoverageSfPerBag, GROUT_DEFAULTS, groutNote } from "../coverage.js";
import { tileConfig, type TileSetup, type TileSku } from "../tileSetup.ts";

const usableSku = (s: TileSku | undefined): boolean =>
  !!s && Number(s.w_in) > 0 && Number(s.h_in) > 0;

export function tileGroutBags(args: {
  tile_setup: TileSetup;
  keptArea_sf: number;
  bagLbs?: number;
}): { bags: number; sfPerBag: number; joint_in: number; note: string } {
  const { tile_setup, keptArea_sf, bagLbs } = args;
  const cfg = tileConfig(tile_setup);
  const primarySku = tile_setup.skus?.find(usableSku) ?? tile_setup.skus?.[0];
  const tileT = (primarySku as { thickness_in?: number } | undefined)?.thickness_in ?? GROUT_DEFAULTS.tileT;
  const grout = {
    tileL: cfg.w_in,
    tileW: cfg.h_in,
    tileT,
    joint: cfg.joint_in,
    bagLbs: bagLbs ?? GROUT_DEFAULTS.bagLbs,
  };
  const sfPerBag = groutCoverageSfPerBag(grout);
  const bags = sfPerBag > 0 ? Math.ceil(keptArea_sf / sfPerBag) : 0;
  return { bags, sfPerBag, joint_in: cfg.joint_in, note: groutNote(grout) };
}
