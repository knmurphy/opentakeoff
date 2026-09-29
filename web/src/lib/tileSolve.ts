// web/src/lib/tileSolve.ts
//
// The inch→foot solve-bridge (design §3.2, M3 Task 1): the ONE place that
// bridges the two unit systems tile-patterning straddles into the generators.
// `tileConfig()` reports SKU/joint sizes in INCHES; the pattern generators
// (`tilePatterns/*.ts`) place tiles in FEET (the plan's own coordinate
// space, matching `ring_ft`); `classifyLayout` takes the room ring in feet
// but the joint width back in INCHES (it emits kept-cut dimensions in
// inches for the caller). The unit arithmetic itself lives in tileUnits.ts
// (inToFt/ftToIn/degToRad) — the single primitive every tile module shares —
// see plan docs/superpowers/plans/2026-08-26-tile-patterning-m3-m4.md.
import { tileConfig, primaryUsableSku, assignedSkuId, type TileConfig, type TileSetup } from "./tileSetup.ts";
import { getPattern, type Bounds, type TileQuad } from "./tilePatterns/index.ts";
import { enumerateSlots } from "./tilePatterns/enumerateSlots.ts";
import { classifyLayout, type Classified } from "./tileGeometry/classify.ts";
import { inToFt } from "./tileUnits.ts";

export type TileLayout = {
  config: TileConfig;
  bounds: Bounds;
  quads: TileQuad[];
  classified: Classified[];
  warnings: string[];
};

function ringBounds(ring: readonly [number, number][]): Bounds | null {
  if (ring.length < 3) return null;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of ring) {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  if (!(maxX > minX) || !(maxY > minY)) return null;
  return { minX, minY, maxX, maxY };
}

export function solveTileLayout(args: {
  tile_setup: TileSetup;
  ring_ft: [number, number][];
  holes_ft?: [number, number][][];
}): TileLayout {
  const { tile_setup, ring_ft, holes_ft } = args;
  const config = tileConfig(tile_setup);
  const bounds = ringBounds(ring_ft);
  if (!bounds) {
    return { config, bounds: { minX: 0, minY: 0, maxX: 0, maxY: 0 }, quads: [], classified: [], warnings: [] };
  }

  // Generator boundary: inches → feet (tileUnits.inToFt).
  const w_ft = inToFt(config.w_in);
  const h_ft = inToFt(config.h_in);
  const joint_ft = inToFt(config.joint_in);

  const gen = getPattern(config.pattern) ?? getPattern("grid");
  const skuId = primaryUsableSku(tile_setup)?.id ?? tile_setup.skus?.[0]?.id ?? "sku";

  const quads = gen
    ? gen.generate({ bounds, w_ft, h_ft, joint_ft, origin: config.origin, rotation_deg: config.rotation_deg, skuId })
    : [];

  // Per-quad SKU resolution (assignment resolver, design §3.2 M3 Task 5):
  // the generator above always stamps ONE default skuId per quad (it has no
  // notion of a multi-SKU field); assignedSkuId() then overrides that
  // per-quad using the condition's tile_setup.assignment and each quad's own
  // `cell` (slotKey.ts), falling back to that same generator default on any
  // miss. Mutates the freshly-generated quads in place — safe: this runs
  // before the caller's layout cache write, and before classifyLayout below.
  //
  // Same-size gate (M3 Task 9): the generator above lays down ONE uniform
  // tile size (w_ft/h_ft, from `config` — the field/primary SKU) — every
  // downstream consumer (tileCalc/* counts, grout, order) trusts that
  // single config.w_in/h_in for every kept cell, regardless of which SKU a
  // quad ends up wearing. An assigned SKU whose footprint DIFFERS from the
  // field would therefore be counted/ordered at the wrong size — so the
  // engine REJECTS such an assignment wholesale rather than silently
  // mis-sizing the order: it skips the resolver loop below (every quad
  // keeps generate()'s single default skuId) and surfaces a QA warning
  // instead. Compared UNORDERED ({min,max}) so a same-footprint SKU that's
  // just rotated (12x24 vs 24x12) is still allowed. Dangling ids (a slot
  // naming a SKU no longer in `skus`) are excluded from this check —
  // assignedSkuId() already falls back for those; they're not a sizing
  // concern. Never throws — this solve runs inside a React useMemo.
  //
  // REACHABLE slots only (review fix, 2026-08-29): assignment.slots can
  // carry STALE keys — reachable under a PRIOR (pattern, unit) but not the
  // current one, e.g. painted at a 3x3 unit and the unit later shrinks to
  // 2x2 without the panel pruning the orphaned "2_2" entry. A quad's `cell`
  // is only ever looked up at a key `enumerateSlots(config.pattern,
  // assignment.unit)` actually emits (assignedSkuId → slotKey), so a stale
  // key never colors a quad — it must not be allowed to drive this gate
  // either, or a SKU that paints nothing can still reject the whole
  // assignment.
  const warnings: string[] = [];
  const assignment = tile_setup.assignment;
  // `unit` is required by the TileAssignment type and TilePanel.jsx always
  // sets it in the same patch as `slots` (clamped to its own UNIT_MAX=4 on
  // that write path) — but this is a runtime guard, no load-time sanitizer
  // (tileSetup.ts's house posture), so a corrupt/partial/imported persisted
  // payload can land with `slots` present and `unit` missing, non-numeric,
  // or simply huge (TilePanel's UNIT_MAX only bounds what the PANEL writes,
  // not what a payload can carry). Two failure modes, both below:
  //   1. null/undefined unit — enumerateSlots() and assignedSkuId()'s own
  //      slotKey() both index through unit.w/unit.h and throw.
  //   2. non-finite or oversized unit — enumerateSlots() is
  //      O(unit.w * unit.h * arity); an insane `w`/`h` (measured: ~1.1s
  //      main-thread freeze at 2000x2000; `h: Infinity` is a true infinite
  //      loop) turns a same-tick solve into a hang, synchronously inside a
  //      React useMemo.
  // isSaneUnit's cap (256) sits comfortably above the panel's own UNIT_MAX
  // (4) AND above the largest unit this codebase's own test suite
  // deliberately constructs (tileTakeoff.test.ts uses {w:100,h:100} to
  // isolate a slot key from mod-wraparound aliasing in a small room) — so
  // it doesn't clip any real usage. It's still bounded: measured,
  // enumerateSlots' worst case at the cap (256 * 256 * herringbone's arity
  // 4 = 262144 iterations) costs ~24ms; at 500 it's ~101ms, at 2000 it's the
  // ~1.1-1.9s freeze this guard exists to prevent (and h/w: Infinity is an
  // outright hang). Either failure mode — missing unit or one over the cap
  // — is treated as "no usable assignment" everywhere below (same fallback
  // the malformed-`slots` case already gets) rather than let a bad shape
  // throw or hang.
  const UNIT_CAP = 256;
  const isSaneUnit = (u: { w: number; h: number } | null | undefined): boolean =>
    !!u &&
    Number.isInteger(u.w) && Number.isInteger(u.h) &&
    u.w >= 1 && u.h >= 1 &&
    u.w <= UNIT_CAP && u.h <= UNIT_CAP;
  const hasUnit = assignment != null && isSaneUnit(assignment.unit);
  const assignedIds = assignment?.slots && hasUnit
    ? new Set(
        enumerateSlots(config.pattern, assignment.unit)
          .map((s) => assignment.slots[s.slot])
          .filter((id): id is string => Boolean(id)),
      )
    : null;
  let sizeMismatch = false;
  if (assignedIds) {
    const fieldSize = [config.w_in, config.h_in].sort((a, b) => a - b);
    for (const id of assignedIds) {
      const sku = (tile_setup.skus || []).find((s) => s.id === id);
      if (!sku) continue;
      const w = Math.max(0.25, Number(sku.w_in) || 0);
      const h = Math.max(0.25, Number(sku.h_in) || 0);
      const size = [w, h].sort((a, b) => a - b);
      if (size[0] !== fieldSize[0] || size[1] !== fieldSize[1]) {
        sizeMismatch = true;
        break;
      }
    }
  }
  if (sizeMismatch) {
    warnings.push("Multi-size tile fields aren't supported yet — the assignment was ignored; make the SKUs the same size.");
  } else if (!assignment || hasUnit) {
    for (const q of quads) q.skuId = assignedSkuId(tile_setup, q.cell);
  }

  // classifyLayout boundary: back to inches (cfg.joint_in), deliberately —
  // it emits kept-cut dimensions in inches for downstream consumers.
  const classified = classifyLayout(quads, ring_ft, holes_ft ?? [], config.joint_in);

  return { config, bounds, quads, classified, warnings };
}
