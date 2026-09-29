import { test } from 'node:test';
import assert from 'node:assert/strict';
import { patternFactor, sizeFactor, computeLaborRom, laborRomReportRows } from '../src/lib/tileCalc/labor.ts';
import { reportJson } from '../src/lib/totals.js';

test('patternFactor: grid/brick_50/brick_33 are 1.0', () => {
  assert.equal(patternFactor('grid'), 1.0);
  assert.equal(patternFactor('brick_50'), 1.0);
  assert.equal(patternFactor('brick_33'), 1.0);
});

test('patternFactor: diagonal is 1.2', () => {
  assert.equal(patternFactor('diagonal'), 1.2);
});

test('patternFactor: herringbone is 1.6', () => {
  assert.equal(patternFactor('herringbone'), 1.6);
});

test('patternFactor: basketweave is 1.4', () => {
  assert.equal(patternFactor('basketweave'), 1.4);
});

test('patternFactor: unknown pattern defaults to 1.0 (straight)', () => {
  assert.equal(patternFactor('pinwheel'), 1.0);
  assert.equal(patternFactor(''), 1.0);
});

test('sizeFactor: 1.3 when max(w,h) >= 18', () => {
  assert.equal(sizeFactor(18, 18), 1.3);
  assert.equal(sizeFactor(12, 24), 1.3);
  assert.equal(sizeFactor(24, 12), 1.3);
});

test('sizeFactor: 1.0 below 18', () => {
  assert.equal(sizeFactor(12, 12), 1.0);
  assert.equal(sizeFactor(17.9, 17.9), 1.0);
});

test('computeLaborRom: empty map in, empty map out', () => {
  const result = computeLaborRom(new Map());
  assert.equal(result.size, 0);
});

test('computeLaborRom: weightedSf = keptArea_sf * patternFactor * sizeFactor, grid + small format', () => {
  const byCond = new Map();
  byCond.set('cond-1', {
    tile_setup: { pattern: 'grid', skus: [{ w_in: 12, h_in: 12 }] },
    counts: { full: 10, cut: 4, corner: 2, hole: 1, safe: 8, keptArea_sf: 100 },
  });
  const result = computeLaborRom(byCond);
  const rom = result.get('cond-1');
  assert.ok(rom);
  assert.equal(rom.weightedSf, 100); // 100 * 1.0 * 1.0
  assert.equal(rom.patternFactor, 1.0);
  assert.equal(rom.sizeFactor, 1.0);
  assert.equal(rom.cutEa, 4);
  assert.equal(rom.cornerEa, 2);
  assert.equal(rom.trimLf, 0);
  assert.equal(rom.jointLf, 0);
});

test('computeLaborRom: trim and joints copied through when present', () => {
  const byCond = new Map();
  byCond.set('cond-2', {
    tile_setup: { pattern: 'grid', skus: [{ w_in: 12, h_in: 12 }] },
    counts: { full: 5, cut: 1, corner: 0, hole: 0, safe: 5, keptArea_sf: 50 },
    trim: { length_lf: 22.5, pieces: 6, corner_outside: 2, corner_inside: 1 },
    joints: { perimeter_lf: 10, field_lf: 40, transition_lf: 0, total_lf: 50, fieldGridSpacing_ft: 1 },
  });
  const result = computeLaborRom(byCond);
  const rom = result.get('cond-2');
  assert.ok(rom);
  assert.equal(rom.trimLf, 22.5);
  assert.equal(rom.jointLf, 50);
});

test('computeLaborRom: diagonal + large-format multiplies BOTH factors', () => {
  const byCond = new Map();
  byCond.set('cond-3', {
    tile_setup: { pattern: 'diagonal', skus: [{ w_in: 24, h_in: 24 }] },
    counts: { full: 20, cut: 6, corner: 3, hole: 0, safe: 18, keptArea_sf: 200 },
  });
  const result = computeLaborRom(byCond);
  const rom = result.get('cond-3');
  assert.ok(rom);
  assert.equal(rom.patternFactor, 1.2);
  assert.equal(rom.sizeFactor, 1.3);
  // 200 * 1.2 * 1.3 = 312
  assert.equal(rom.weightedSf, 312);
});

test('computeLaborRom: keeps multiple conditions keyed correctly', () => {
  const byCond = new Map();
  byCond.set('a', {
    tile_setup: { pattern: 'herringbone', skus: [{ w_in: 6, h_in: 24 }] },
    counts: { full: 1, cut: 1, corner: 1, hole: 0, safe: 1, keptArea_sf: 10 },
  });
  byCond.set('b', {
    tile_setup: { pattern: 'basketweave', skus: [{ w_in: 6, h_in: 6 }] },
    counts: { full: 1, cut: 1, corner: 1, hole: 0, safe: 1, keptArea_sf: 10 },
  });
  const result = computeLaborRom(byCond);
  assert.equal(result.size, 2);
  // herringbone (1.6) * large-format (max=24>=18 -> 1.3) = 1.6*1.3=2.08 -> 10*2.08=20.8
  assert.equal(result.get('a')?.weightedSf, 20.8);
  // basketweave (1.4) * small (1.0) = 1.4 -> 10*1.4=14
  assert.equal(result.get('b')?.weightedSf, 14);
});

test('computeLaborRom: routes the field SKU through primaryUsableSku — a leading zero-size SKU is skipped', () => {
  const byCond = new Map();
  byCond.set('cond-1', {
    // A zero-size entry first, then a real 12x24 large-format SKU. The sole
    // resolver (positive w×h) must skip the zero entry; a naive non-null
    // check would pick it and read sizeFactor(0,12)=1.0 instead of 1.3.
    tile_setup: { pattern: 'grid', skus: [{ w_in: 0, h_in: 12 }, { w_in: 12, h_in: 24 }] },
    counts: { full: 1, cut: 0, corner: 0, hole: 0, safe: 1, keptArea_sf: 50 },
  });
  const rom = computeLaborRom(byCond).get('cond-1');
  assert.ok(rom);
  assert.equal(rom.sizeFactor, 1.3);   // 12x24 is large-format; the 0x12 entry is not usable
  assert.equal(rom.weightedSf, 65);    // 50 * 1.0 * 1.3
});

test('laborRomReportRows: null/empty inputs return []', () => {
  assert.deepEqual(laborRomReportRows(null, [{ id: 'c1' }]), []);
  assert.deepEqual(laborRomReportRows(new Map(), [{ id: 'c1' }]), []);
  assert.deepEqual(laborRomReportRows(new Map([['c1', { weightedSf: 1, patternFactor: 1, sizeFactor: 1, cutEa: 0, cornerEa: 0, trimLf: 0, jointLf: 0 }]]), null), []);
});

test('laborRomReportRows: emits matched rows, skips absent, applies multiplier to scaled fields only', () => {
  const laborRomByCond = new Map([
    ['c1', { weightedSf: 100, patternFactor: 1.2, sizeFactor: 1.3, cutEa: 5, cornerEa: 2, trimLf: 10, jointLf: 4 }],
  ]);
  const rows = [
    { id: 'c1', finish_tag: 'FT-1', multiplier: 3 },
    { id: 'c2', finish_tag: 'FT-2', multiplier: 1 },
  ];
  const out = laborRomReportRows(laborRomByCond, rows);
  assert.equal(out.length, 1);
  assert.deepEqual(out[0], {
    condition_id: 'c1',
    finish_tag: 'FT-1',
    multiplier: 3,
    weighted_sf: 300,
    pattern_factor: 1.2,
    size_factor: 1.3,
    cut_ea: 5,
    corner_ea: 2,
    trim_lf: 30,
    joint_lf: 12,
  });
});

test('laborRomReportRows: defaults missing multiplier to 1', () => {
  const laborRomByCond = new Map([
    ['c1', { weightedSf: 50, patternFactor: 1, sizeFactor: 1, cutEa: 0, cornerEa: 0, trimLf: 0, jointLf: 0 }],
  ]);
  const out = laborRomReportRows(laborRomByCond, [{ id: 'c1', finish_tag: 'FT-1' }]);
  assert.equal(out[0].multiplier, 1);
  assert.equal(out[0].weighted_sf, 50);
});

test('reportJson: labor_rom defaults to [] and leaves the rest unchanged', () => {
  const withLabor = reportJson({ rows: [{ id: 'c1', finish_tag: 'FT-1' }] });
  assert.deepEqual(withLabor.labor_rom, []);
  const baseline = reportJson({ rows: [{ id: 'c1', finish_tag: 'FT-1' }] });
  const { labor_rom, ...rest } = withLabor;
  const { labor_rom: labor_rom2, ...rest2 } = baseline;
  assert.deepEqual(rest, rest2);
});

test('reportJson: passes through supplied labor_rom array', () => {
  const rows = [{ id: 'c1', finish_tag: 'FT-1' }];
  const laborRom = [{ condition_id: 'c1', finish_tag: 'FT-1', weighted_sf: 42 }];
  const out = reportJson({ rows, laborRom });
  assert.deepEqual(out.labor_rom, laborRom);
});
