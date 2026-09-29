// Tile takeoff report column (M8) — mirrors the roll-goods column tests in
// reportColumns.test.ts (same ctx-map / ×N convention). Tile's ONLY table
// column is the PO-line order quantity (default-hidden); the rest of the tile
// figure lives in the TilePanel, JSON tile_goods, cut-sheet CSV, and the
// optional shop-drawing page.
import { test } from "node:test";
import assert from "node:assert/strict";
import { tileColProfile, TILE_FIELDS } from "../src/lib/reportColumns.js";

interface ColDescriptor {
  key: string;
  header: string;
  defaultVisible: boolean;
  get: (row: { id: string; multiplier: number }, ctx?: unknown) => unknown;
}

function tileSummary(overrides: Record<string, unknown> = {}) {
  return {
    counts: { full: 10, cut: 3, corner: 2, hole: 1, safe: 15, keptArea_sf: 100 },
    order: { boxes: 4, figured: 15, withMargin: 16 },
    grout: { bags: 2 },
    ...overrides,
  };
}

test("tileColProfile: [] for null/empty map (byte-stable CSV when no tile takeoff)", () => {
  assert.deepEqual(tileColProfile(null), []);
  assert.deepEqual(tileColProfile(new Map()), []);
});

test("tileColProfile: exactly one column (Tile Boxes), default-hidden", () => {
  const tileByCond = new Map([["c1", tileSummary()]]);
  const cols = tileColProfile(tileByCond) as ColDescriptor[];
  assert.equal(cols.length, 1);
  assert.equal(TILE_FIELDS.length, 1);
  assert.equal(cols[0].key, "tile:boxes");
  assert.equal(cols[0].header, "Tile Boxes");
  assert.equal(cols[0].defaultVisible, false, "the one tile column is opt-in, off by default");
});

test("tileColProfile getter: reads ctx.tileByCond by row id, boxes ×N, blank when absent", () => {
  const tileByCond = new Map([["c1", tileSummary()]]);
  const cols = tileColProfile(tileByCond) as ColDescriptor[];
  const ctx = { tileByCond };
  const row = { id: "c1", multiplier: 3 };
  assert.equal(cols[0].get(row, ctx), 12, "4 boxes × 3");
  assert.equal(cols[0].get({ id: "missing", multiplier: 1 }, ctx), "", "absent condition reads blank");
  assert.equal(cols[0].get(row, undefined), "", "no ctx reads blank");
});
