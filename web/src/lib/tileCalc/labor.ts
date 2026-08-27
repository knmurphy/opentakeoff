// Labor ROM (rough order of magnitude) — design §3.9.
//
// weighted labor SF = measured SF (keptArea_sf) × pattern factor × size factor.
// The two factors MULTIPLY (they are independent labor-time premiums: layout
// complexity and large-format handling), never pick-max/either-or.
//
// This is a QUANTITY, not a cost: no dollar rates live here. Downstream
// pricing multiplies weightedSf (and the driver counts) by a $/unit rate the
// estimator supplies elsewhere.
//
// Deferred, NOT modeled here:
//   - wall-tile premium (wall-tile milestone)
//   - wet-area labor uplift (M11/M13)
// Explicitly EXCLUDED (out of the geometry-derived family entirely):
//   - demo, floor-prep, mobilization
import { round2 } from '../num.js';
import { primaryUsableSku } from '../tileSetup.ts';

export type LaborRom = {
	weightedSf: number;
	patternFactor: number;
	sizeFactor: number;
	cutEa: number;
	cornerEa: number;
	trimLf: number;
	jointLf: number;
};

const PATTERN_FACTORS: Record<string, number> = {
	grid: 1.0,
	brick_50: 1.0,
	brick_33: 1.0,
	diagonal: 1.2,
	herringbone: 1.6,
	basketweave: 1.4,
};

export function patternFactor(pattern: string): number {
	return PATTERN_FACTORS[pattern] ?? 1.0; // unknown/straight patterns default to 1.0
}

// Large-format premium: tiles with either dimension >= 18in take longer to
// set (weight, leveling, fewer pieces per labor-hour to cover the same SF).
export function sizeFactor(w_in: number, h_in: number): number {
	return Math.max(w_in, h_in) >= 18 ? 1.3 : 1.0;
}

export function computeLaborRom(tileByCond: Map<string, any>): Map<string, LaborRom> {
	const result = new Map<string, LaborRom>();
	for (const [condId, summary] of tileByCond) {
		const { tile_setup, counts, trim, joints } = summary;
		// Route through the SOLE usable-SKU resolver — the field is tiled in the
		// FIRST usable SKU (positive w×h), never a zero-size entry, so the size
		// factor can never disagree with the field solve's own SKU choice.
		const sku = primaryUsableSku(tile_setup);
		const sf = sku ? sizeFactor(sku.w_in, sku.h_in) : 1.0;
		const pf = patternFactor(tile_setup.pattern);
		result.set(condId, {
			weightedSf: round2(counts.keptArea_sf * pf * sf),
			patternFactor: pf,
			sizeFactor: sf,
			cutEa: counts.cut,
			cornerEa: counts.corner,
			trimLf: trim ? trim.length_lf : 0,
			jointLf: joints ? joints.total_lf : 0,
		});
	}
	return result;
}
