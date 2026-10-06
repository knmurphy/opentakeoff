// BASE and HEAD: paths to two checkouts' web/ folders, e.g. BASE=../main/web HEAD=../branch/web node --import tsx <this file>
// Header text a few px wider than its column; neighbour's left-aligned cells start under its overhang.
const H = await import(process.env.HEAD + "/src/lib/scheduleRead.ts");
const B = await import(process.env.BASE + "/src/lib/scheduleRead.ts");
const cell = (str, x, y) => ({ str, x, y, w: str.length * 7, h: 12, rot: 0 });
const f = (r) => r.rows.map((x) => [x.finish_tag, x.description, x.spec_color, x.category].join(" | ")).join("\n        ");
for (const over of [-2, 0, 1, 3, 6]) {
  // SPEC column [320, 400); header "SPECIFICATION" = 91px centred -> [314.5, 405.5); COLOR column starts 400, cells at 400+4+... shift by `over`
  const colorX = 405.5 - over;
  const spans = [cell("FINISH SCHEDULE", 40, 30), cell("CODE", 50, 70), cell("MATERIAL", 180, 70), cell("SPECIFICATION", 314.5, 70), cell("COLOR", 520, 70),
    cell("FL-1", 44, 100), cell("CARPET TILE", 130, 100), cell("GRAY", colorX, 100),
    cell("RB-2", 44, 124), cell("RUBBER BASE", 130, 124), cell("BLACK", colorX, 124)];
  for (const ocr of [false]) { const b = B.readScheduleSpans(spans, { ocr }), h = H.readScheduleSpans(spans, { ocr });
    console.log(`overlap ${over}px ${JSON.stringify(b) === JSON.stringify(h) ? "SAME" : "DIFF"}\n  base: ${f(b)}\n  head: ${f(h)}`); }
}
