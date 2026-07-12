// Native Excel (.xlsx) export — a hand-rolled SpreadsheetML writer zipped with
// fflate (already a dependency; lazy-loaded like the ingest zip path, so Excel
// export costs nothing until the button is clicked). No SheetJS, no exceljs:
// the report needs exactly one thing — worksheets of plain cells — and a
// megabyte of spreadsheet library is the wrong price for it.
//
// Two layers:
//   buildXlsxParts(sheets)  -> Map<path, xmlString>   pure, fully testable
//   xlsxBytes(sheets)       -> Promise<Uint8Array>    parts zipped by fflate
//   downloadXlsx(name, sheets)                        browser download
//   takeoffWorkbook(...)    -> sheets[]               the report as a workbook
//
// A sheet is { name, rows, autoFilter?, freezeTop? } where rows is an array of
// cell arrays. A cell is:
//   number            -> numeric cell (NaN/Infinity written as blank)
//   string            -> inline string, XML-escaped
//   null/undefined/"" -> skipped
//   { v, s }          -> value with a named style (see STYLE below)
//
// Every string goes out as an INLINE string (<is><t>…), never a shared string
// and never a formula — so a condition named "=HYPERLINK(…)" or "+SUM(A1)" is
// inert text in Excel, the same reasoning as CSV formula-injection hygiene.
// Numbers keep full precision in <v>; display rounding is the style's job
// (#,##0.0 for quantities, #,##0 for counts), so the workbook shows what the
// report shows while the cells stay exact for downstream arithmetic.

import { conditionTotals, grandTotals, materialsSummary, sheetTotals } from "./totals.js";
import { parseSheetKey } from "./sheets";
import { areaVal, areaUnit, lenVal, lenUnit } from "./units";

// Named styles -> cellXfs index in stylesXml(). th = bold header with a rule
// under it; qty = 1-decimal grouped number; int = whole number; b* = bold
// (grand-total row). Keep the two tables in lockstep.
const STYLE = { th: 1, qty: 2, int: 3, b: 4, bqty: 5, bint: 6 };

// XML-escape text, dropping the control characters XML 1.0 forbids (a pasted
// NUL or vertical tab in a condition name must not produce a file Excel
// refuses to open). Tab/newline/CR survive. Escape sequences, never literal
// control bytes — a raw byte in source makes git treat the file as binary.
export function xmlEsc(v) {
  return String(v)
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "") // eslint-disable-line no-control-regex
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// 0-based column index -> spreadsheet letters (0=A, 25=Z, 26=AA …)
export function colRef(i) {
  let s = "";
  for (let n = i; n >= 0; n = Math.floor(n / 26) - 1) s = String.fromCharCode(65 + (n % 26)) + s;
  return s;
}

// Excel worksheet-name rules: non-empty, ≤31 chars, none of [ ] : * ? / \,
// no leading/trailing apostrophe, unique case-insensitively, and "History" is
// reserved by Excel. `used` carries the taken names across calls.
export function safeSheetName(name, used = new Set()) {
  let s = String(name ?? "").replace(/[[\]:*?/\\]/g, " ").replace(/^'+|'+$/g, "").trim().slice(0, 31).trim();
  if (!s || s.toLowerCase() === "history") s = s ? `${s}_` : "Sheet";
  let out = s;
  for (let n = 2; used.has(out.toLowerCase()); n++) {
    const tail = ` (${n})`;
    out = s.slice(0, 31 - tail.length) + tail;
  }
  used.add(out.toLowerCase());
  return out;
}

const cellVal = (c) => (c !== null && typeof c === "object" ? c.v : c);
const cellStyle = (c) => (c !== null && typeof c === "object" && c.s ? STYLE[c.s] || 0 : 0);
const isBlank = (v) => v === null || v === undefined || v === "";

// Column widths from content: Excel's width unit is roughly one character.
// Grouped 1-decimal display adds ~2 chars over the raw digits; +2 breathing
// room; clamp so a long note can't produce a 300-char column.
function colWidths(rows) {
  const w = [];
  for (const row of rows) row.forEach((c, i) => {
    const v = cellVal(c);
    if (isBlank(v)) return;
    const len = typeof v === "number" ? String(Math.round(v)).length + 3 : String(v).length;
    if (!w[i] || len > w[i]) w[i] = len;
  });
  return w.map((len) => Math.min(44, Math.max(8, (len || 0) + 2)));
}

// One worksheet part. Row/cell refs (r=) are explicit so skipped blanks never
// shift their neighbours.
/** @param {{ rows: any[][], autoFilter?: { cols: number, rows: number } | null, freezeTop?: boolean }} sheet */
export function worksheetXml({ rows, autoFilter = null, freezeTop = false }) {
  const parts = ['<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'];
  parts.push('<sheetViews><sheetView workbookViewId="0">'
    + (freezeTop ? '<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>' : "")
    + "</sheetView></sheetViews>");
  const widths = colWidths(rows);
  if (widths.length) {
    parts.push("<cols>" + widths.map((wd, i) => `<col min="${i + 1}" max="${i + 1}" width="${wd}" customWidth="1"/>`).join("") + "</cols>");
  }
  parts.push("<sheetData>");
  rows.forEach((row, ri) => {
    parts.push(`<row r="${ri + 1}">`);
    row.forEach((c, ci) => {
      const v = cellVal(c);
      if (isBlank(v)) return;
      const ref = `${colRef(ci)}${ri + 1}`;
      const s = cellStyle(c);
      const sAttr = s ? ` s="${s}"` : "";
      if (typeof v === "number") {
        if (Number.isFinite(v)) parts.push(`<c r="${ref}"${sAttr}><v>${v}</v></c>`);
        return;
      }
      const t = xmlEsc(v);
      const sp = /^\s|\s$/.test(String(v)) ? ' xml:space="preserve"' : "";
      parts.push(`<c r="${ref}"${sAttr} t="inlineStr"><is><t${sp}>${t}</t></is></c>`);
    });
    parts.push("</row>");
  });
  parts.push("</sheetData>");
  // autoFilter: header + data rows only — a grand-total row below the range
  // stays out of the filter. Emitted AFTER sheetData (schema order).
  if (autoFilter && autoFilter.cols > 0 && autoFilter.rows > 0) {
    parts.push(`<autoFilter ref="A1:${colRef(autoFilter.cols - 1)}${autoFilter.rows}"/>`);
  }
  parts.push("</worksheet>");
  return parts.join("");
}

// Minimal stylesheet: two custom number formats, normal + bold fonts, and the
// two fills/one border Excel insists exist. cellXfs order must match STYLE.
function stylesXml() {
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
    + '<numFmts count="2"><numFmt numFmtId="164" formatCode="#,##0.0"/><numFmt numFmtId="165" formatCode="#,##0"/></numFmts>'
    + '<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>'
    + '<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>'
    + '<borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border>'
    + '<border><left/><right/><top/><bottom style="thin"><color auto="1"/></bottom><diagonal/></border></borders>'
    + '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>'
    + '<cellXfs count="7">'
    + '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>'
    + '<xf numFmtId="0" fontId="1" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1"/>'
    + '<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>'
    + '<xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>'
    + '<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>'
    + '<xf numFmtId="164" fontId="1" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1"/>'
    + '<xf numFmtId="165" fontId="1" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1"/>'
    + "</cellXfs>"
    + '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>'
    + "</styleSheet>";
}

// The full package as path -> XML string. Pure: tests unzip nothing, they
// read the parts straight off this map.
export function buildXlsxParts(sheets) {
  const used = new Set();
  const named = sheets.map((sh) => ({ ...sh, name: safeSheetName(sh.name, used) }));
  const parts = new Map();
  parts.set("[Content_Types].xml",
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
    + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
    + '<Default Extension="xml" ContentType="application/xml"/>'
    + '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
    + '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>'
    + named.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("")
    + "</Types>");
  parts.set("_rels/.rels",
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
    + '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>'
    + "</Relationships>");
  parts.set("xl/workbook.xml",
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
    + "<sheets>"
    + named.map((sh, i) => `<sheet name="${xmlEsc(sh.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("")
    + "</sheets></workbook>");
  parts.set("xl/_rels/workbook.xml.rels",
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
    + named.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join("")
    + `<Relationship Id="rId${named.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>`
    + "</Relationships>");
  parts.set("xl/styles.xml", stylesXml());
  named.forEach((sh, i) => parts.set(`xl/worksheets/sheet${i + 1}.xml`, worksheetXml(sh)));
  return parts;
}

export async function xlsxBytes(sheets) {
  const { zipSync, strToU8 } = await import("fflate");
  const files = {};
  for (const [path, xml] of buildXlsxParts(sheets)) files[path] = strToU8(xml);
  return zipSync(files, { level: 6 });
}

export async function downloadXlsx(filename, sheets) {
  const bytes = await xlsxBytes(sheets);
  const blob = new Blob([bytes], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ---------------------------------------------------------------------------
// The takeoff report as a workbook — same sources and same numbers as the
// on-screen table and the CSV/JSON exports (conditionTotals / grandTotals /
// materialsSummary / sheetTotals), so the four tabs can never disagree with
// the report. Waste applies to order quantities only, never measured ones.

const ROLE_LABEL = {
  floor_area: "Floor area", deduct: "Deduct", surface_area: "Wall (surface)",
  linear: "Linear", count: "Count",
};

// "plan.pdf#3" -> "plan — p.3" (page 1 keys are the bare file name)
function sheetLabel(sheetId) {
  const { file, page } = parseSheetKey(sheetId);
  const stem = file.replace(/\.pdf$/i, "");
  return page > 1 ? `${stem} — p.${page}` : stem;
}

export function takeoffWorkbook({ projectName = "", units = "imperial", conditions, shapes }) {
  const M = units === "metric";
  const AU = areaUnit(units), LU = lenUnit(units);
  const av = (sf) => areaVal(sf, units), lv = (lf) => lenVal(lf, units);
  const rows = conditionTotals(conditions, shapes).filter((r) => r.shape_count > 0);
  const g = grandTotals(rows);
  const th = (v) => ({ v, s: "th" });
  const qty = (v) => ({ v, s: "qty" });
  const int = (v) => ({ v, s: "int" });

  // — Summary: the STACK-style per-condition breakdown + grand total —
  const sumHeader = ["Finish", "Shapes", "Multiplier", "Waste %", `Floor ${AU}`, `Wall ${AU}`, `Border ${AU}`,
    `Total ${AU}`, LU, "EA", `Total ${AU} (w/ waste)`, `${LU} (w/ waste)`, ...(M ? [] : ["SY (w/ waste)"])];
  const summary = [sumHeader.map(th)];
  for (const r of rows) {
    summary.push([r.finish_tag, int(r.shape_count), int(r.multiplier), int(r.waste_pct),
      qty(av(r.floor_sf)), qty(av(r.wall_sf)), qty(av(r.border_sf)), qty(av(r.total_sf)), qty(lv(r.lf)), int(r.ea),
      qty(av(r.total_sf_net)), qty(lv(r.lf_net)), ...(M ? [] : [qty(r.sy_net)])]);
  }
  summary.push([{ v: "TOTAL", s: "b" }, "", "", "", "", "", "", { v: av(g.total_sf), s: "bqty" }, { v: lv(g.lf), s: "bqty" },
    { v: g.ea, s: "bint" }, { v: av(g.total_sf_net), s: "bqty" }, { v: lv(g.lf_net), s: "bqty" }, ...(M ? [] : [{ v: g.sy_net, s: "bqty" }])]);
  summary.push([]);
  summary.push([`Total ${AU} (w/ waste) = measured quantity × waste %. Wall ${AU} comes from Surface-Area traces (run × height); Border ${AU} from Linear runs with a thickness.`]);
  if (projectName) summary.push([`Project: ${projectName} — generated with OpenTakeoff`]);

  // — By sheet: where the quantities live in the drawing set —
  const bySheetRows = sheetTotals(conditions, shapes);
  const bySheet = [["Sheet", "Finish", `Floor ${AU}`, `Wall ${AU}`, `Border ${AU}`, LU, "EA"].map(th)];
  for (const r of bySheetRows) {
    bySheet.push([sheetLabel(r.sheet_id), r.finish_tag,
      qty(av(r.floor_sf)), qty(av(r.wall_sf)), qty(av(r.border_sf)), qty(lv(r.lf)), int(r.ea)]);
  }
  bySheet.push([]);
  bySheet.push(["Base measured quantities per sheet — the condition multiplier and waste apply at condition level (see Summary)."]);

  // — Materials: per-condition needs, then the combined buy list —
  const basisLabel = (b) => (b === "linear" ? LU : b === "count" ? "EA" : AU);
  const matRows = [];
  for (const r of rows) for (const m of (r.materials || [])) {
    matRows.push([r.finish_tag, m.name, qty(m.qty), m.unit, `1 ${m.unit || "unit"} / ${m.per} ${basisLabel(m.basis)}`, m.note || ""]);
  }
  const materials = [["Finish", "Material", "Qty", "Unit", "Coverage", "Note"].map(th), ...matRows];
  const combined = materialsSummary(rows);
  if (combined.length) {
    materials.push([]);
    materials.push(["Material (combined)", "Qty", "Unit"].map(th));
    for (const m of combined) materials.push([m.name, qty(m.qty), m.unit]);
  }

  // — Shapes: the per-shape audit trail (deducts carry their sign) —
  const shapesRows = [["#", "Sheet", "Finish", "Role", `Area ${AU}`, LU, "EA", `Height ${M ? "m" : "ft"}`].map(th)];
  const condById = new Map(conditions.map((c) => [c.id, c]));
  shapes.forEach((s, i) => {
    const c = condById.get(s.condition_id);
    if (!c) return;
    const cp = s.computed || {};
    const sign = s.measure_role === "deduct" ? -1 : 1;
    shapesRows.push([int(i + 1), sheetLabel(s.sheet_id), c.finish_tag, ROLE_LABEL[s.measure_role] || s.measure_role,
      cp.area_sf ? qty(av(sign * cp.area_sf)) : "",
      s.measure_role === "linear" && cp.perimeter_lf ? qty(lv(cp.perimeter_lf)) : "",
      s.measure_role === "count" ? int(cp.count || 1) : "",
      s.measure_role === "surface_area" && s.height_ft ? qty(M ? lv(s.height_ft) : s.height_ft) : ""]);
  });

  const out = [
    { name: "Summary", rows: summary, freezeTop: true, autoFilter: { cols: sumHeader.length, rows: 1 + rows.length } },
    { name: "By sheet", rows: bySheet, freezeTop: true, autoFilter: { cols: 7, rows: 1 + bySheetRows.length } },
  ];
  if (matRows.length) out.push({ name: "Materials", rows: materials, freezeTop: true });
  out.push({ name: "Shapes", rows: shapesRows, freezeTop: true, autoFilter: { cols: 8, rows: shapesRows.length } });
  return out;
}
