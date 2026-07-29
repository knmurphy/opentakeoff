// One-Click E2E fixture — a synthetic vector floor plan at 1/4" = 1'-0"
// (1 ft = 18 pt), letter landscape, exercising the three doorway conditions
// the tool must handle:
//   OFFICE 101 — fully enclosed room                    → plain flood, 120 SF
//   CONF   102 — 3'-0" CASED opening (no door symbol)   → gap sealing, 120 SF
//   STOR   103 — same opening WITH leaf + swing arc     → arc bounds the fill,
//                no sealing, 120 SF minus the ~7 SF swing wedge
// The swing arc is emitted as a real cubic bezier (drawSvgPath), matching how
// CAD exports draw door swings, so extractVectorGeometry's curve path is what
// gets tested — not a polyline stand-in.
//
// Usage: node e2e/make-fixture.cjs [outfile.pdf]
const { PDFDocument, StandardFonts, rgb } = require("pdf-lib");
const fs = require("fs");
const path = require("path");

(async () => {
  const doc = await PDFDocument.create();
  const page = doc.addPage([792, 612]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const black = rgb(0.1, 0.12, 0.16);
  const line = (x1, y1, x2, y2, w = 1.6) =>
    page.drawLine({ start: { x: x1, y: y1 }, end: { x: x2, y: y2 }, thickness: w, color: black });

  // sheet border + title block (the scale note is what detectScale reads)
  page.drawRectangle({ x: 12, y: 12, width: 768, height: 588, borderWidth: 1.2, borderColor: black });
  page.drawRectangle({ x: 560, y: 12, width: 220, height: 70, borderWidth: 1, borderColor: black });
  page.drawText("A-101  FLOOR PLAN", { x: 572, y: 58, size: 12, font: bold, color: black });
  page.drawText('SCALE: 1/4" = 1\'-0"', { x: 572, y: 38, size: 11, font, color: black });

  const label = (tag, num, cx) => {
    page.drawText(tag, { x: cx - 22, y: 400, size: 13, font: bold, color: black });
    page.drawText(num, { x: cx - 12, y: 382, size: 12, font, color: black });
  };

  // OFFICE 101 — enclosed, 216×180 pt (12×10 ft)
  line(60, 300, 276, 300); line(276, 300, 276, 480); line(276, 480, 60, 480); line(60, 480, 60, 300);
  label("OFFICE", "101", 168);

  // CONF 102 — south wall has a 54 pt (3'-0") CASED opening, nothing drawn in it
  line(276, 300, 366, 300); line(420, 300, 492, 300);
  line(492, 300, 492, 480); line(492, 480, 276, 480);
  label("CONF", "102", 384);

  // STOR 103 — same opening, but with the door drawn: leaf open 90° into the
  // room + quarter-circle swing arc from leaf tip to the strike jamb
  line(492, 300, 560, 300); line(614, 300, 708, 300);
  line(708, 300, 708, 480); line(708, 480, 492, 480);
  label("STOR", "103", 600);
  line(560, 300, 560, 354, 1.0);                       // leaf, hinge at the left jamb
  // quarter arc about the hinge (560,300), r = 54: tip (560,354) → jamb (614,300).
  // drawSvgPath is y-down from its anchor; anchored at the page top so
  // svgY = 612 − pdfY. k = 0.5523 r is the standard circular-arc control offset.
  page.drawSvgPath("M 560 258 C 589.83 258, 614 282.17, 614 312", { x: 0, y: 612, borderWidth: 1.0, borderColor: black });

  const out = process.argv[2] || path.join(__dirname, "out", "plan.pdf");
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, await doc.save());
  console.log("fixture:", out);
})();
