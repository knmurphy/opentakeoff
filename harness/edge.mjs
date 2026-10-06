// BASE and HEAD: paths to two checkouts' web/ folders, e.g. BASE=../main/web HEAD=../branch/web node --import tsx <this file>
const H = await import(process.env.HEAD + "/src/lib/scheduleRead.ts");
const B = await import(process.env.BASE + "/src/lib/scheduleRead.ts");
const cell = (str, x, y, w = str.length * 7, h = 12) => ({ str, x, y, w, h });
const f = (r) => r.rows.map((x) => [x.finish_tag, x.description, x.manufacturer, x.spec_color, x.remarks, x.suggested].join(" | "));
const run = (name, spans) => { for (const ocr of [false, true]) { const b = B.readScheduleSpans(spans, { ocr }), h = H.readScheduleSpans(spans, { ocr });
  const same = JSON.stringify(b) === JSON.stringify(h); console.log(`== ${name} ocr=${ocr} ${same ? "SAME" : "DIFF"}`); if (!same || process.env.V) { console.log("  base: " + f(b).join("\n        ")); console.log("  head: " + f(h).join("\n        ")); } } };
// header helper: cols [[name,x,w]] centered
const T = (cols, rows) => [cell("FINISH SCHEDULE", 40, 30), ...cols.map(([s, x, w]) => cell(s, x + (w - s.length * 7) / 2, 70)),
  ...rows.flatMap((r, j) => r.flatMap((v, i) => { if (!v) return []; const [s, al] = Array.isArray(v) ? v : [v, "c"]; const [, x, w] = cols[i]; return [cell(s, al === "l" ? x + 4 : x + (w - s.length * 7) / 2, 100 + j * 24)]; }))];
const C5 = [["CODE", 40, 80], ["MATERIAL", 120, 200], ["MFG", 320, 120], ["COLOR", 440, 300], ["REMARKS", 740, 200]];
// 1. em-dash cell in COLOR, left aligned, MFG blank in that row; other rows earn MFG
run("dash", T(C5, [["FL-1", "CARPET TILE", "VENDOR-A", "GRAY", ""], ["FL-2", "RUBBER BASE", "", ["—", "l"], ""], ["FL-3", "LVT", "VENDOR-B", "BLUE", ""]]));
run("dash-only", T(C5, [["FL-1", "CARPET TILE", "", ["—", "l"], ""], ["FL-2", "RUBBER BASE", "", ["—", "l"], ""]]));
// 2. two text-layer runs in one COLOR cell (pdf.js split), MFG blank everywhere
const two = (cols, j, i, a, b) => { const [, x] = cols[i]; return [cell(a, x + 4, 100 + j * 24), cell(b, x + 4 + a.length * 7 + 5, 100 + j * 24)]; };
run("color-two-runs-mfg-blank", [...T(C5, [["FL-1", "CARPET TILE", "", "", ""], ["FL-2", "RUBBER BASE", "", "", ""]]), ...two(C5, 0, 3, "WARM", "WHITE"), ...two(C5, 1, 3, "COOL GRAY", "2")]);
// 3. wrapped color cell (2 lines), MFG blank
run("wrapped", [...T(C5, [["FL-1", "CARPET TILE", "", ["WARM", "l"], ""], ["FL-2", "RUBBER BASE", "VENDOR-A", "GRAY", ""]]), cell("WHITE", 444, 112)]);
// 4. repeated word: vendor GRAY CO, color GRAY
run("gray-co", T(C5, [["FL-1", "CARPET TILE", "GRAY CO", "GRAY", ""], ["FL-2", "RUBBER BASE", "", ["GRAY", "l"], ""]]));
// 5. NOTES last, REMARKS absent, COLOR left-aligned wide; notes blank in a row
const C4 = [["CODE", 40, 80], ["MATERIAL", 120, 200], ["COLOR", 320, 260], ["NOTES", 580, 120]];
run("notes-last", T(C4, [["FL-1", "CARPET TILE", "GRAY", "ZONE-A"], ["FL-2", "RUBBER BASE", ["BLUE", "l"], ""]]));
// 6. SPEC last, description both absorber and target, SPEC blank
const C3 = [["CODE", 40, 80], ["MATERIAL", 120, 200], ["SPEC", 320, 120]];
run("spec-last", T(C3, [["FL-1", "CARPET TILE", "09 68 13"], ["FL-2", "RUBBER BASE", ""]]));
// 7. MFG + SPEC both right-absorbed by COLOR
const C6 = [["CODE", 40, 80], ["MATERIAL", 120, 200], ["MFG", 320, 120], ["SPEC", 440, 120], ["COLOR", 560, 200]];
run("mfg+spec", T(C6, [["FL-1", "CARPET TILE", "VENDOR-A", "09 68 13", "GRAY"], ["FL-2", "RUBBER BASE", "", "09 65 13", "BLUE"], ["FL-3", "LVT", "VENDOR-B", "", "SLATE"]]));
