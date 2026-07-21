// Per-shape id diff for auto-flagging — issue #149's remaining scope.
//
// This is deliberately NOT the same kind of diff as lib/revisions.js:
// revisions.js diffs QUANTITY TOTALS because shape uids don't normally
// survive a re-imported sheet. This module instead pairs INDIVIDUAL shapes
// by id, which is only valid because TakeoffCanvas' `resheet` command
// (shapeCommands.js) preserves shape ids when transferring a takeoff onto a
// reissued sheet — a baseline revision saved right after transfer and the
// shapes the user later adjusts on that same sheet_id share identity, so a
// real positional diff (not a fuzzy bbox-overlap heuristic) is possible.
//
// Known limitation: this compares `computed` as stored on each side, so it
// can't tell "the estimator changed the takeoff" from "the sheet's scale
// changed since the baseline was saved" — a rescale between baseline and
// current reads as a quantity delta on every shape, untouched or not. See
// the comment on TakeoffCanvas' transferShapesToSheet for why this is an
// accepted gap rather than something this module tries to correct for.
import { vertsEqual } from "./shapeCommands.js";

const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;
// Same 0.05 SF / 0.5 EA display-precision philosophy as revisions.js, applied
// per-shape instead of to a summed row.
const visible = (unit, d) => Math.abs(d) >= (unit === "ea" ? 0.5 : 0.05);

// A cloud drawn flush against a shape's own edges leaves no gap to click the
// shape through — standard drafting practice clouds a change with clearance
// anyway, so pad the bbox rather than fit it exactly (clamped to the sheet).
const PAD = 0.015;
function bboxOf(vertsList) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const verts of vertsList) {
    for (const [x, y] of verts) {
      if (x < x0) x0 = x;
      if (y < y0) y0 = y;
      if (x > x1) x1 = x;
      if (y > y1) y1 = y;
    }
  }
  const clamp = (v) => Math.round(Math.max(0, Math.min(1, v)) * 10000) / 10000;
  return [[clamp(x0 - PAD), clamp(y0 - PAD)], [clamp(x1 + PAD), clamp(y1 + PAD)]];
}

function deltaLabel(before, after) {
  const b = before?.computed || {}, a = after?.computed || {};
  const parts = [];
  const dSf = round2((a.area_sf || 0) - (b.area_sf || 0));
  if (visible("sf", dSf)) parts.push(`${dSf > 0 ? "+" : "−"}${Math.abs(dSf).toFixed(1)} SF`);
  const dLf = round2((a.perimeter_lf || 0) - (b.perimeter_lf || 0));
  if (visible("lf", dLf)) parts.push(`${dLf > 0 ? "+" : "−"}${Math.abs(dLf).toFixed(1)} LF`);
  const dEa = (a.count || 0) - (b.count || 0);
  if (visible("ea", dEa)) parts.push(`${dEa > 0 ? "+" : "−"}${Math.abs(dEa)} EA`);
  return parts.join(", ");
}

// diffShapesForCloud(baselineShapes, currentShapes, sheetId, conditionTagOf)
// → [{ type: "cloud", sheet_id, rect: [[x0,y0],[x1,y1]], text }]
//
// conditionTagOf: (condition_id) => finish_tag, injected by the caller so
// this module stays free of any dependency on the conditions array shape.
//
// One cloud per changed shape — no overlap clustering. Clustering needs a
// distance threshold with no calibration data (the same objection the
// original issue #149 design raised about a bbox-overlap approach); a
// per-shape cloud stays directly traceable to one delta.
export function diffShapesForCloud(baselineShapes, currentShapes, sheetId, conditionTagOf) {
  const base = (baselineShapes || []).filter((s) => s.sheet_id === sheetId);
  const cur = (currentShapes || []).filter((s) => s.sheet_id === sheetId);
  const baseById = new Map(base.map((s) => [s.id, s]));
  const curById = new Map(cur.map((s) => [s.id, s]));
  const clouds = [];

  for (const s of cur) {
    const b = baseById.get(s.id);
    const tag = conditionTagOf(s.condition_id) || "?";
    if (!b) {
      const label = deltaLabel(null, s);
      clouds.push({ type: "cloud", sheet_id: sheetId, rect: bboxOf([s.verts_norm]), text: `Added — ${tag}${label ? " " + label : ""}` });
      continue;
    }
    const label = deltaLabel(b, s);
    if (!vertsEqual(b.verts_norm, s.verts_norm) || label) {
      clouds.push({ type: "cloud", sheet_id: sheetId, rect: bboxOf([b.verts_norm, s.verts_norm]), text: `Changed — ${tag}${label ? " " + label : ""}` });
    }
  }
  for (const s of base) {
    if (curById.has(s.id)) continue;
    const tag = conditionTagOf(s.condition_id) || "?";
    const label = deltaLabel(s, null);
    clouds.push({ type: "cloud", sheet_id: sheetId, rect: bboxOf([s.verts_norm]), text: `Removed — ${tag}${label ? " " + label : ""}` });
  }
  return clouds;
}
