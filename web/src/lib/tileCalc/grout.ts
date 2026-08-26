// web/src/lib/tileCalc/grout.ts
//
// Grout bags derived from the layout's tile geometry (design §3.3), not a
// lumped SF constant: the coverage.js formula's (L+W)/(L·W) term IS
// joint-length-per-SF, so bags scale with the actual tile/joint dims.
import { groutCoverageSfPerBag, GROUT_DEFAULTS, groutNote } from "../coverage.js";
import { tileConfig, primaryUsableSku, type TileSetup } from "../tileSetup.ts";

export function tileGroutBags(args: {
  tile_setup: TileSetup;
  keptArea_sf: number;
  bagLbs?: number;
}): { bags: number; sfPerBag: number; joint_in: number; note: string } {
  const { tile_setup, keptArea_sf, bagLbs } = args;
  const cfg = tileConfig(tile_setup);
  const primarySku = primaryUsableSku(tile_setup);
  const tileT = primarySku?.thickness_in ?? GROUT_DEFAULTS.tileT;
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
