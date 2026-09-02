// The oracle noise injector — the harness's synthetic "OCR engine" (Experiment 1
// in docs/SCHEDULE-OCR.md; the doctrine lives in docs/OCR-EVAL-DOCTRINE.md).
// Takes ground-truth words and returns them degraded the way real OCR degrades:
// character confusions weighted toward the classic glyph pairs (O↔0, I↔1, S↔5…),
// deletions, insertions, and whole-word drops (detection misses). Boxes are left
// untouched — a real engine's boxes wobble, but Experiment 1 isolates the
// parser's sensitivity to TEXT errors, and unchanged boxes let the harness pair
// degraded words back to their sources by position alone.
//
// Deterministic by construction: a seeded PRNG, no Math.random, so every sweep
// point is reproducible and the tests can pin exact outputs.
import type { OcrWord } from "./types";

/** mulberry32 — tiny seeded PRNG, plenty for noise injection. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Classic OCR confusion pairs, applied both ways. Lowercase variants are
// derived, so mixed-case text (manufacturer names, model numbers) degrades the
// same way scanned mixed-case text actually does.
const CONFUSION_PAIRS: [string, string][] = [
  ["O", "0"], ["I", "1"], ["L", "1"], ["S", "5"], ["B", "8"], ["G", "6"],
  ["Z", "2"], ["C", "G"], ["E", "F"], ["D", "O"], ["Q", "O"], ["U", "V"],
  ["T", "7"], ["A", "4"], ["'", "."], [",", "."], ["-", "_"],
];
const CONFUSIONS: Map<string, string[]> = (() => {
  const m = new Map<string, string[]>();
  const add = (a: string, b: string) => m.set(a, [...(m.get(a) ?? []), b]);
  for (const [a, b] of CONFUSION_PAIRS) {
    add(a, b); add(b, a);
    const la = a.toLowerCase(), lb = b.toLowerCase();
    if (la !== a || lb !== b) { add(la, lb); add(lb, la); }
  }
  return m;
})();

// Fallback random substitution/insertion alphabet — what a recognizer emits
// when it's simply wrong, not glyph-confused.
const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789.-#\"'&/ ";

export type NoiseOpts = {
  /** target character error rate 0..1 — per-char probability of one edit
   * (substitution / deletion / insertion, weighted 60/25/15) */
  cer?: number;
  /** per-word probability of a detection miss (the word never comes back) */
  dropRate?: number;
};

/** Degrade words with OCR-shaped noise. Order is preserved; dropped words are
 * simply absent (score.matchWords reports them as detection misses). */
export function degradeWords(words: OcrWord[], opts: NoiseOpts, seed: number): OcrWord[] {
  const cer = opts.cer ?? 0;
  const dropRate = opts.dropRate ?? 0;
  const rng = mulberry32(seed);
  const out: OcrWord[] = [];
  for (const wd of words) {
    if (dropRate > 0 && rng() < dropRate) continue;
    let str = wd.str;
    if (cer > 0) {
      let res = "";
      for (const ch of str) {
        const r = rng();
        if (r < cer * 0.6) {
          // substitution — glyph confusion when the char has one, random otherwise
          const cand = CONFUSIONS.get(ch);
          res += cand ? cand[Math.floor(rng() * cand.length)] : ALPHABET[Math.floor(rng() * ALPHABET.length)];
        } else if (r < cer * 0.85) {
          // deletion — emit nothing
        } else if (r < cer) {
          // insertion — keep the char, then a stray
          res += ch + ALPHABET[Math.floor(rng() * ALPHABET.length)];
        } else {
          res += ch;
        }
      }
      str = res;
    }
    out.push(str === wd.str ? wd : { ...wd, str });
  }
  return out;
}
