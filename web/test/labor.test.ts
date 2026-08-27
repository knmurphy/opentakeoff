import { test } from 'node:test';
import assert from 'node:assert/strict';
import { patternFactor, sizeFactor, computeLaborRom } from '../src/lib/tileCalc/labor.ts';

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
