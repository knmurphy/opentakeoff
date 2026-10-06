// Run from web/ on main: node --import tsx keep.mjs   (invented codes and vendors only)
// Each box reads correctly on main; a fix for MFG on a box that already reads should keep it that way.
import { readScheduleSpans } from './src/lib/scheduleRead.ts';
const cell = ([str, x], y) => ({ str, x, y, w: str.length * 7, h: 12 });
const box = (header, rows) => [cell(['FINISH SCHEDULE', 40], 30), ...header.map((c) => cell(c, 70)),
  ...rows.flatMap((r, j) => r.map((c) => cell(c, 100 + j * 24)))];
const cases = {
  // MFG printed with nothing under it; COLOR cells left-aligned under a centred header
  'blank MFG': box([['CODE', 66], ['MATERIAL', 222], ['MFG', 429.5], ['COLOR', 612.5], ['REMARKS', 835.5]], [
    [['FL-1', 44], ['RESILIENT FLOOR', 124], ['GRAY', 504], ['ZONE-A', 764]],
    [['TL-2', 44], ['CERAMIC TILE', 124], ['BLUE', 504], ['ZONE-B', 764]]]),
  // the same, with one COLOR cell arriving as two spans (OCR words, or two pdf.js runs)
  'split cell': box([['CODE', 66], ['MATERIAL', 222], ['MFG', 429.5], ['COLOR', 612.5], ['REMARKS', 835.5]], [
    [['FL-1', 44], ['RESILIENT FLOOR', 124], ['WARM', 504], ['WHITE', 540], ['ZONE-A', 764]],
    [['TL-2', 44], ['CERAMIC TILE', 124], ['BLUE', 504], ['ZONE-B', 764]]]),
  // SPECIFICATION's box reaches 3 px over the COLOR cells beside it
  'header overhang': box([['CODE', 50], ['MATERIAL', 180], ['SPECIFICATION', 314.5], ['COLOR', 520]], [
    [['FL-1', 44], ['CARPET TILE', 130], ['GRAY', 402.5]],
    [['RB-2', 44], ['RUBBER BASE', 130], ['BLACK', 402.5]]]),
};
for (const [id, spans] of Object.entries(cases)) for (const ocr of [false, true])
  console.log(id, ocr ? 'OCR ' : 'text', JSON.stringify(readScheduleSpans(spans, { ocr }).rows.map((r) => [r.finish_tag, r.description, r.manufacturer, r.spec_color])));
