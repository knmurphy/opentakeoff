import { test } from "node:test";
import assert from "node:assert/strict";
import { tileGroutBags } from "../src/lib/tileCalc/grout.ts";
import { groutCoverageSfPerBag, GROUT_DEFAULTS } from "../src/lib/coverage.js";
import { mintTileSetup } from "../src/lib/tileSetup.ts";

test("tileGroutBags: derives sf/bag from the tile geometry (matches coverage.js)", () => {
  const ts = mintTileSetup(); ts.skus[0].w_in = 12; ts.skus[0].h_in = 24; ts.joint.width_in = 0.125;
  const expectSf = groutCoverageSfPerBag({ tileL: 12, tileW: 24, tileT: GROUT_DEFAULTS.tileT, joint: 0.125, bagLbs: GROUT_DEFAULTS.bagLbs });
  const g = tileGroutBags({ tile_setup: ts, keptArea_sf: expectSf * 3 });
  assert.ok(Math.abs(g.sfPerBag - expectSf) < 1e-6);
  assert.equal(g.bags, 3);
});

test("tileGroutBags: smaller tile ⇒ more joint ⇒ fewer sf/bag ⇒ more bags", () => {
  const big = mintTileSetup(); big.skus[0].w_in = 24; big.skus[0].h_in = 24; big.joint.width_in = 0.125;
  const small = mintTileSetup(); small.skus[0].w_in = 2; small.skus[0].h_in = 2; small.joint.width_in = 0.125;
  const b = tileGroutBags({ tile_setup: big, keptArea_sf: 200 });
  const s = tileGroutBags({ tile_setup: small, keptArea_sf: 200 });
  assert.ok(s.bags > b.bags, "mosaic eats far more grout than large format");
});
