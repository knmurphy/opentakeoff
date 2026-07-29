// Room auto-naming — suggest a label for a One-Click region from the drawing's
// OWN text (pure, no DOM; node-testable).
//
// Plans label rooms in place: a name line ("OFFICE", "CONF", "ELEC") with a
// room-number line under it ("101", "102A"), or both on one line. After the
// flood traces a region, the tokens whose anchors fall INSIDE the ring are
// clustered into lines and scored; the best name+number pair becomes the
// suggested label. Dimension strings, scale notes, and leader text are
// rejected by pattern — a wrong suggestion costs more trust than no
// suggestion. Raster plans have no text layer and return null upstream.
import { pointInPoly } from "./geometry.js";

export interface NameToken { str: string; x: number; y: number; h: number; }

const NAME_RE = /^[A-Z][A-Z0-9 .,'&()/-]{1,28}$/;      // "BREAK", "CONF.", "JAN/STOR"
const NUM_RE = /^\d{2,4}[A-Z]?$/;                      // "101", "102A" — 1-digit strays are keynotes
const NAME_WITH_NUM_RE = /^([A-Z][A-Z .,'&()/-]{1,24})\s+(\d{2,4}[A-Z]?)$/; // "OFFICE 101"
const JUNK_RE = /['"″′=]|^\d+\s*[xX×]\s*\d+|^(SCALE|TYP\b|SIM\b|N\.T\.S|NO\.\s|REF\b)/;
// keynote / sheet / detail references — "AE213", "A1.02", "K12" — letters glued
// to a number are cross-references, never room names
const KEYNOTE_RE = /\b[A-Z]{1,3}\d{2,}(\.\d+)?\b/;
const alphaCount = (s: string): number => (s.match(/[A-Z]/g) || []).length;

interface Line { y: number; h: number; text: string; }

/** Cluster in-region tokens into text lines (reading order). */
function linesInRegion(tokens: NameToken[], poly: [number, number][]): Line[] {
  const inside = tokens.filter((t) => {
    const s = (t.str || "").trim();
    if (!s || JUNK_RE.test(s)) return false;
    // anchor is the glyph run's left/baseline corner; also test an approximate
    // center so a label hugging a wall still counts
    const cx = t.x + s.length * t.h * 0.28, cy = t.y - t.h * 0.35;
    return pointInPoly(t.x, t.y, poly) || pointInPoly(cx, cy, poly);
  });
  inside.sort((a, b) => a.y - b.y || a.x - b.x);
  const lines: Array<Line & { xs: Array<{ x: number; str: string }> }> = [];
  for (const t of inside) {
    const last = lines[lines.length - 1];
    if (last && Math.abs(t.y - last.y) <= Math.max(t.h, last.h) * 0.7) {
      last.xs.push({ x: t.x, str: t.str.trim() });
      last.y = (last.y + t.y) / 2;
      last.h = Math.max(last.h, t.h);
    } else lines.push({ y: t.y, h: t.h, text: "", xs: [{ x: t.x, str: t.str.trim() }] });
  }
  return lines.map((l) => ({
    y: l.y, h: l.h,
    // finish-tag fragments arrive as "CPT -" / "- 1" — strip dangling punctuation
    text: l.xs.sort((a, b) => a.x - b.x).map((p) => p.str).join(" ").replace(/\s+/g, " ")
      .replace(/^[-.,/&\s]+|[-.,/&\s]+$/g, "").trim(),
  }));
}

/** Best label for the region, or null when nothing reads like a room tag. */
export function roomNameFromTokens(tokens: NameToken[], poly: [number, number][]): string | null {
  if (!tokens?.length || !poly || poly.length < 3) return null;
  const lines = linesInRegion(tokens, poly);
  if (!lines.length) return null;
  let cyArr = poly.map((p) => p[1]);
  const centerY = (Math.min(...cyArr) + Math.max(...cyArr)) / 2;
  const byCenter = (a: Line, b: Line) => Math.abs(a.y - centerY) - Math.abs(b.y - centerY);

  // one-line "OFFICE 101" wins outright (keynote-shaped refs excluded)
  const combined = lines.filter((l) => NAME_WITH_NUM_RE.test(l.text) && !KEYNOTE_RE.test(l.text)).sort(byCenter);
  if (combined.length) return combined[0].text;

  const names = lines.filter((l) => NAME_RE.test(l.text) && alphaCount(l.text) >= 2 && !NUM_RE.test(l.text) && !KEYNOTE_RE.test(l.text)).sort(byCenter);
  const nums = lines.filter((l) => NUM_RE.test(l.text));
  if (names.length) {
    const name = names[0];
    // the room number sits on the neighboring line (usually just below)
    const near = nums.filter((n) => Math.abs(n.y - name.y) <= Math.max(name.h, n.h) * 3.5)
      .sort((a, b) => Math.abs(a.y - name.y) - Math.abs(b.y - name.y));
    if (near.length) return `${name.text} ${near[0].text}`;
    // a bare name with no number must look like a WORD, not a finish-tag
    // fragment ("CPT", "VCT") — those are 2-3 caps scattered through rooms
    if (alphaCount(name.text) >= 4) return name.text;
  }
  if (nums.length) return nums.sort(byCenter)[0].text;   // number-only plans
  return null;
}
