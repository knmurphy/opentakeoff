// Tile takeoff + Labor ROM report columns (M8) — mirrors the roll-goods
// column tests in reportColumns.test.ts (same ctx-map / ×N conventions).
import { test } from "node:test";
import assert from "node:assert/strict";
import { round2 } from "../src/lib/num.js";
import { tileColProfile, TILE_FIELDS, laborRomColProfile, LABOR_ROM_FIELDS } from "../src/lib/reportColumns.js";

interface ColDescriptor {
  key: string;
  header: string;
  get: (row: { id: string; multiplier: number }, ctx?: unknown) => unknown;
}

function tileSummary(overrides: Record<string, unknown> = {}) {
  return {
    counts: { full: 10, cut: 3, corner: 2, keptArea_sf: 100.456, safe: 15 },
    order: { boxes: 4, withMargin: 12.345 },
    grout: { bags: 2 },
    trim: { length_lf: 20 },
    joints: { total_lf: 30 },
    ...overrides,
  };
}

test("tileColProfile: [] for null/empty map (byte-stable CSV when no tile takeoff)", () => {
  assert.deepEqual(tileColProfile(null), []);
  assert.deepEqual(tileColProfile(new Map()), []);
});

test("tileColProfile: one descriptor per TILE_FIELDS, keys and headers in order", () => {
  const tileByCond = new Map([["c1", tileSummary()]]);
  const cols = tileColProfile(tileByCond) as ColDescriptor[];
  assert.equal(cols.length, TILE_FIELDS.length);
  assert.deepEqual(
    cols.map((c) => [c.key, c.header]),
    TILE_FIELDS.map((f) => [f.key, f.header]),
  );
});

test("tileColProfile getter: reads ctx.tileByCond by row id, blank when absent", () => {
  const tileByCond = new Map([["c1", tileSummary()]]);
  const cols = tileColProfile(tileByCond) as ColDescriptor[];
  const ctx = { tileByCond };
  assert.equal(cols[0].get({ id: "other", multiplier: 1 }, ctx), "", "no tile summary for this row → blank");
  assert.equal(cols[0].get({ id: "c1", multiplier: 1 }, undefined), "", "no ctx at all → blank");
});

test("tileColProfile getter: ×N applies to boxes/withMargin/grout, NOT to full/cut/corner (as-measured)", () => {
  const tileByCond = new Map([["c1", tileSummary()]]);
  const cols = tileColProfile(tileByCond) as ColDescriptor[];
  const byKey = new Map(cols.map((c) => [c.key, c]));
  const ctx = { tileByCond };
  const row = { id: "c1", multiplier: 3 };

  assert.equal(byKey.get("tile:full")?.get(row, ctx), 10, "full is as-measured, no ×N");
  assert.equal(byKey.get("tile:cut")?.get(row, ctx), 3, "cut is as-measured, no ×N");
  assert.equal(byKey.get("tile:corner")?.get(row, ctx), 2, "corner is as-measured, no ×N");
  assert.equal(byKey.get("tile:area_sf")?.get(row, ctx), round2(100.456), "area SF is as-measured, no ×N");

  assert.equal(byKey.get("tile:safe")?.get(row, ctx), 45, "safe ×N");
  assert.equal(byKey.get("tile:boxes")?.get(row, ctx), 12, "boxes ×N");
  assert.equal(byKey.get("tile:with_margin")?.get(row, ctx), round2(12.345 * 3), "withMargin ×N");
  assert.equal(byKey.get("tile:grout_bags")?.get(row, ctx), 6, "grout bags ×N");
  assert.equal(byKey.get("tile:trim_lf")?.get(row, ctx), 60, "trim LF ×N");
  assert.equal(byKey.get("tile:joint_lf")?.get(row, ctx), 90, "joint LF ×N");
});

test("tileColProfile getter: trim/joints missing on the summary reads 0, never NaN", () => {
  const tileByCond = new Map([
    [
      "c1",
      {
        counts: { full: 1, cut: 0, corner: 0, keptArea_sf: 10, safe: 1 },
        order: { boxes: 1, withMargin: 1 },
        grout: { bags: 1 },
        // trim/joints absent — pre-trim/pre-joints summary
      },
    ],
  ]);
  const cols = tileColProfile(tileByCond) as ColDescriptor[];
  const byKey = new Map(cols.map((c) => [c.key, c]));
  const ctx = { tileByCond };
  const row = { id: "c1", multiplier: 2 };
  assert.equal(byKey.get("tile:trim_lf")?.get(row, ctx), 0);
  assert.equal(byKey.get("tile:joint_lf")?.get(row, ctx), 0);
});

// ── Labor ROM ─────────────────────────────────────────────────────────────

function laborRom(overrides: Record<string, unknown> = {}) {
  return {
    weightedSf: 100,
    patternFactor: 1.2,
    sizeFactor: 1.3,
    cutEa: 5,
    cornerEa: 2,
    trimLf: 10,
    jointLf: 20,
    ...overrides,
  };
}

test("laborRomColProfile: [] for null/empty map", () => {
  assert.deepEqual(laborRomColProfile(null), []);
  assert.deepEqual(laborRomColProfile(new Map()), []);
});

test("laborRomColProfile: one descriptor per LABOR_ROM_FIELDS, keys and headers in order", () => {
  const laborRomByCond = new Map([["c1", laborRom()]]);
  const cols = laborRomColProfile(laborRomByCond) as ColDescriptor[];
  assert.equal(cols.length, LABOR_ROM_FIELDS.length);
  assert.deepEqual(
    cols.map((c) => [c.key, c.header]),
    LABOR_ROM_FIELDS.map((f) => [f.key, f.header]),
  );
});

test("laborRomColProfile getter: reads ctx.laborRomByCond by row id, blank when absent", () => {
  const laborRomByCond = new Map([["c1", laborRom()]]);
  const cols = laborRomColProfile(laborRomByCond) as ColDescriptor[];
  const ctx = { laborRomByCond };
  assert.equal(cols[0].get({ id: "other", multiplier: 1 }, ctx), "");
  assert.equal(cols[0].get({ id: "c1", multiplier: 1 }, undefined), "");
});

test("laborRomColProfile getter: weightedSf/trimLf/jointLf ×N; patternFactor/sizeFactor/cutEa/cornerEa unmultiplied", () => {
  const laborRomByCond = new Map([["c1", laborRom()]]);
  const cols = laborRomColProfile(laborRomByCond) as ColDescriptor[];
  const byKey = new Map(cols.map((c) => [c.key, c]));
  const ctx = { laborRomByCond };
  const row = { id: "c1", multiplier: 3 };

  assert.equal(byKey.get("laborRom:weighted_sf")?.get(row, ctx), 300, "weightedSf ×N");
  assert.equal(byKey.get("laborRom:pattern_factor")?.get(row, ctx), 1.2, "patternFactor unmultiplied");
  assert.equal(byKey.get("laborRom:size_factor")?.get(row, ctx), 1.3, "sizeFactor unmultiplied");
  assert.equal(byKey.get("laborRom:cut_ea")?.get(row, ctx), 5, "cutEa unmultiplied (as-measured)");
  assert.equal(byKey.get("laborRom:corner_ea")?.get(row, ctx), 2, "cornerEa unmultiplied (as-measured)");
  assert.equal(byKey.get("laborRom:trim_lf")?.get(row, ctx), 30, "trimLf ×N");
  assert.equal(byKey.get("laborRom:joint_lf")?.get(row, ctx), 60, "jointLf ×N");
});
