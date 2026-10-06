// BASE and HEAD: paths to two checkouts' web/ folders, e.g. BASE=../main/web HEAD=../branch/web node --import tsx <this file>
const H = await import(process.env.HEAD + "/src/lib/scheduleRead.ts");
const B = await import(process.env.BASE + "/src/lib/scheduleRead.ts");
const cell = (str, x, y, extra = {}) => ({ str, x, y, w: str.length * 7, h: 12, rot: 0, ...extra });
const f = (r) => JSON.stringify(r.rows.map((x) => [x.finish_tag, x.description, x.manufacturer, x.spec_color, x.remarks, x.suggested, x.code_checks ?? ""])) + (r.skipped ? " skipped=" + r.skipped : "");
const hdr = [cell("FINISH SCHEDULE", 40, 30), cell("CODE", 50, 70), cell("MATERIAL", 150, 70), cell("MFG", 350, 70), cell("COLOR", 480, 70), cell("NOTES", 640, 70)];
const cases = {
  numericRecovery: [...hdr, cell("FL-1", 44, 100), cell("CARPET TILE", 130, 100), cell("VENDOR-A", 340, 100), cell("GRAY", 480, 100),
    cell("88-2", 44, 124), cell("RUBBER BASE", 130, 124), cell("VENDOR-B", 340, 124), cell("BLUE", 480, 124), cell("NOT USED", 636, 124),
    cell("FL-3", 44, 148), cell("LVT", 130, 148), cell("VENDOR-A", 340, 148), cell("SLATE", 480, 148)],
  epoxSkipped: [...hdr, cell("FL-1", 44, 100), cell("CARPET TILE", 130, 100), cell("VENDOR-A", 340, 100), cell("GRAY", 480, 100),
    cell("EPOX", 44, 124), cell("EPOXY FLOOR", 130, 124), cell("VENDOR-B", 340, 124), cell("BLUE", 480, 124),
    cell("FL-3", 44, 148), cell("LVT", 130, 148), cell("", 340, 148), cell("SLATE", 480, 148), cell("NOT USED", 636, 148)],
  notUsedOnlyInNotes: [...hdr, cell("FL-1", 44, 100), cell("CARPET TILE", 130, 100), cell("GRAY", 480, 100), cell("NOT USED", 636, 100),
    cell("FL-2", 44, 124), cell("LVT", 130, 124), cell("BLUE", 480, 124)],
};
for (const [n, sp] of Object.entries(cases)) for (const ocr of [false, true]) {
  const b = B.readScheduleSpans(sp, { ocr }), h = H.readScheduleSpans(sp, { ocr });
  console.log(n, "ocr=" + ocr, JSON.stringify(b) === JSON.stringify(h) ? "SAME" : "DIFF"); console.log("  base", f(b)); console.log("  head", f(h));
}
