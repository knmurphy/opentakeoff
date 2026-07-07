// Sheet-key convention: page 1 = bare file name; pages 2+ = "name#page".
// Lives in its own module so pure-math consumers (totals.js) don't drag in
// pdfjs-dist via sheets.ts for a two-line parser.
export interface ParsedSheetKey { file: string; page: number }

// Inverse of sheetKey: split on the LAST '#' and only when the tail is
// numeric — file names may contain '#'.
export function parseSheetKey(key: string): ParsedSheetKey {
  const i = key.lastIndexOf("#");
  if (i > 0 && /^\d+$/.test(key.slice(i + 1))) return { file: key.slice(0, i), page: parseInt(key.slice(i + 1), 10) };
  return { file: key, page: 1 };
}
