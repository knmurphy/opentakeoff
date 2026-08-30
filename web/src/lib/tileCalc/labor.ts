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

// The additive labor_rom block for opentakeoff.report.v1 — mirrors
// rollReportRows/tileReportRows exactly (rows = conditionTotals output,
// finish_tag and multiplier come from there so the block can never disagree
// with the table). ×N applies to the scaled quantities (weightedSf, trimLf,
// jointLf — labor scales with unit count); pattern_factor/size_factor/
// cut_ea/corner_ea are as-measured and NOT multiplied (they describe the
// field, not the purchase).
type ConditionRow = { id: string; finish_tag?: string; multiplier?: number };
type LaborRomReportRow = {
	condition_id: string;
	finish_tag: string | undefined;
	multiplier: number;
	weighted_sf: number;
	pattern_factor: number;
	size_factor: number;
	cut_ea: number;
	corner_ea: number;
	trim_lf: number;
	joint_lf: number;
};

export function laborRomReportRows(laborRomByCond: Map<string, LaborRom> | null | undefined, rows: unknown): LaborRomReportRow[] {
	if (!laborRomByCond || !laborRomByCond.size || !Array.isArray(rows)) return [];
	const out: LaborRomReportRow[] = [];
	for (const r of rows as ConditionRow[]) {
		const li = laborRomByCond.get(r.id);
		if (!li) continue;
		const mult = r.multiplier || 1;
		out.push({
			condition_id: r.id,
			finish_tag: r.finish_tag,
			multiplier: mult,
			weighted_sf: round2(li.weightedSf * mult),
			pattern_factor: li.patternFactor,
			size_factor: li.sizeFactor,
			cut_ea: li.cutEa,
			corner_ea: li.cornerEa,
			trim_lf: round2(li.trimLf * mult),
			joint_lf: round2(li.jointLf * mult),
		});
	}
	return out;
}
