// Role-aware takeoff totaling — the same rules the original commit endpoint used
// (see the reference test in the project history), reimplemented client-side:
//
//   floor_area    → adds to floor SF
//   deduct        → subtracts from floor SF
//   surface_area  → adds to wall SF (a wall trace: LF × height) — never base LF
//   linear        → adds to LF, and (if the condition has thickness) border SF
//   count         → adds to EA
//   multiplier    → × N identical units, applied to every quantity
//   waste_pct     → a flooring allowance added on top (SF + LF; never EA)
//
// `shape.computed` already holds the per-shape numbers (computed at draw time
// against that sheet's scale), so totaling is pure arithmetic — no scale here.

const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;

export function conditionTotals(conditions, shapes) {
  return conditions.map((c) => {
    const mult = c.multiplier || 1;
    const waste = Math.max(0, Number(c.waste_pct) || 0);
    const w = 1 + waste / 100;
    const cs = shapes.filter((s) => s.condition_id === c.id);
    let floor = 0, wall = 0, border = 0, lf = 0, ea = 0;
    for (const s of cs) {
      const cp = s.computed || {};
      switch (s.measure_role) {
        case "deduct": floor -= cp.area_sf || 0; break;
        case "floor_area": floor += cp.area_sf || 0; break;
        case "surface_area": wall += cp.area_sf || 0; break;
        case "linear": lf += cp.perimeter_lf || 0; border += cp.area_sf || 0; break;
        case "count": ea += cp.count || 1; break;
        default: break;
      }
    }
    floor *= mult; wall *= mult; border *= mult; lf *= mult; ea *= mult;
    const total = floor + wall + border;
    return {
      id: c.id, finish_tag: c.finish_tag, color: c.color, fill: c.fill, hatch: c.hatch,
      multiplier: mult, waste_pct: waste, shape_count: cs.length,
      floor_sf: round2(floor), wall_sf: round2(wall), border_sf: round2(border),
      lf: round2(lf), ea,
      total_sf: round2(total),
      // waste-adjusted (order quantities)
      floor_sf_net: round2(floor * w), wall_sf_net: round2(wall * w),
      border_sf_net: round2(border * w), lf_net: round2(lf * w),
      total_sf_net: round2(total * w),
      sy_net: round2((total * w) / 9),
    };
  });
}

export function grandTotals(rows) {
  const sum = (k) => rows.reduce((n, r) => n + (r[k] || 0), 0);
  return {
    total_sf: round2(sum("total_sf")), total_sf_net: round2(sum("total_sf_net")),
    lf: round2(sum("lf")), lf_net: round2(sum("lf_net")),
    ea: sum("ea"), sy_net: round2(sum("sy_net")),
  };
}

// CSV: one row per condition, with both net (measured) and waste-adjusted columns.
export function totalsToCsv(rows, projectName = "") {
  const esc = (v) => {
    const s = String(v ?? "");
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const header = [
    "Finish", "Shapes", "Multiplier", "Waste %",
    "Floor SF", "Wall SF", "Border SF", "Total SF", "LF", "EA",
    "Total SF (w/ waste)", "LF (w/ waste)", "SY (w/ waste)",
  ];
  const lines = [header.map(esc).join(",")];
  for (const r of rows) {
    lines.push([
      r.finish_tag, r.shape_count, r.multiplier, r.waste_pct,
      r.floor_sf, r.wall_sf, r.border_sf, r.total_sf, r.lf, r.ea,
      r.total_sf_net, r.lf_net, r.sy_net,
    ].map(esc).join(","));
  }
  const g = grandTotals(rows);
  lines.push(["TOTAL", "", "", "", "", "", "", g.total_sf, g.lf, g.ea, g.total_sf_net, g.lf_net, g.sy_net].map(esc).join(","));
  const title = projectName ? `# ${projectName} — OpenTakeoff report\n` : "";
  return title + lines.join("\n") + "\n";
}

export function downloadText(filename, text, type = "text/plain") {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
