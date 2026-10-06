// BASE and HEAD: paths to two checkouts' web/ folders, e.g. BASE=../main/web HEAD=../branch/web node --import tsx <this file>
// OCR word-split fuzz: one span per word, jitter. Env: AL=left|mixed|center, NR, N, SEED0, OCR=1, WORDS=1 (default 1), LAYOUTS=all|core
const H = await import(process.env.HEAD + "/src/lib/scheduleRead.ts");
const B = await import(process.env.BASE + "/src/lib/scheduleRead.ts");
const mulberry = (a) => () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const MATS = ["RESILIENT FLOOR", "CERAMIC TILE", "RUBBER BASE", "CARPET TILE", "SEALED CONCRETE", "PORCELAIN TILE", "LVT"];
const VENS = ["VENDOR-A", "VENDOR A", "ACME FLOORS", "GRAY CO", "TRANSITIONS INC", "BLUE RIDGE TILE CO", "VENDOR-T"];
const COLS = ["GRAY", "BLUE", "WARM WHITE", "BLACK", "SLATE", "COOL GRAY 2"];
const NOTES = ["ZONE-A", "SEE A-501", "ALL FLOORS", "", "NOT USED", "BY OWNER"];
const SPECS = ["09 65 13", "09 30 00", "096813", ""];
const FIELD = { M: "description", V: "manufacturer", K: "spec_color", N: "remarks", P: "description" };
const LAYOUTS = [
  ["C","M","V","K","N"], ["C","M","K","V","N"], ["C","V","M","K"], ["C","M","K","N","V"],
  ["C","M","K","Vx"],          // MFG last, no remarks
  ["C","M","K","NX"],          // NOTES last, REMARKS absent
  ["C","M","V","P","K"],       // two renames share COLOR (right)
  ["C","M","K","V","NX"],      // two renames share COLOR (left)
  ["C","M","P","K"],           // SPEC absorbed by COLOR on right
  ["C","M","P"],               // SPEC last: description is absorber and target
  ["C","P","M","K"],           // SPEC first, absorbed by MATERIAL on right
  ["C","M","V","NX"],          // MFG absorbed? (no known right) -> left MATERIAL; NOTES left MATERIAL
];
export function trial(seed, AL, NR, WORDS = true) {
  const rnd = mulberry(seed * 2654435761 + 7);
  const pick = (a) => a[Math.floor(rnd() * a.length)];
  const j2 = () => (rnd() * 4 - 2);
  const alias = pick(["MFG", "MFR"]);
  const layout = pick(LAYOUTS).map((k) => k);
  const nName = pick(["REMARKS", "NOTES"]);
  const hdrName = { C: "CODE", M: "MATERIAL", V: alias, Vx: alias, K: "COLOR", N: nName, NX: "NOTES", P: pick(["SPEC", "SPECIFICATION"]) };
  const key = (k) => k.replace("x", "").replace("X", "");
  const cw = 5 + rnd() * 2;  // char width
  const widths = layout.map((k) => key(k) === "C" ? 60 + rnd() * 40 : 90 + rnd() * 220);
  const align = AL ?? pick(["left", "center", "mixed"]);
  const nr = NR ?? (2 + Math.floor(rnd() * 5));
  const fillV = rnd(), fillN = rnd();
  const rows = Array.from({ length: nr }, (_, j) => ({ C: `${pick(["FL", "TL", "RB", "CPT"])}-${j + 1}`, M: pick(MATS), V: rnd() < fillV ? pick(VENS) : "", K: pick(COLS), N: rnd() < fillN ? pick(NOTES) : "", P: pick(SPECS) }));
  let x = 40; const xs = widths.map((w) => { const a = x; x += w; return a; });
  const spans = [];
  const emit = (str, x0, ytop) => {
    const h = 8 + rnd() * 4;
    if (!WORDS) { spans.push({ str, x: x0 + j2(), y: ytop + j2(), w: str.length * cw + j2(), h, rot: 0 }); return; }
    let cx = x0;
    for (const w of str.split(" ")) { const ww = w.length * cw; spans.push({ str: w, x: cx + j2(), y: ytop + j2(), w: Math.max(3, ww + j2()), h, rot: 0 }); cx += ww + cw * (0.5 + rnd() * 0.6); }
  };
  emit("FINISH SCHEDULE", 40, 30);
  layout.forEach((k, i) => { const s = hdrName[k]; emit(s, xs[i] + (widths[i] - s.length * cw) / 2, 70); });
  rows.forEach((r, j) => layout.forEach((k, i) => { const v = r[key(k)]; if (!v) return;
    const a = align === "mixed" ? pick(["left", "center"]) : align;
    const w = v.length * cw; if (w > widths[i] - 8) { r[key(k)] = ""; return; }
    emit(v, a === "left" ? xs[i] + 4 : xs[i] + (widths[i] - w) / 2, 100 + j * 24); }));
  return { spans, rows, layout: layout.map(key), hdr: layout.map((k) => hdrName[k]).join("|"), widths: widths.map(Math.round), align, nr };
}
const truthOf = (t, layout, k) => {
  if (k === "M" || k === "P") { const parts = []; if (layout.includes("M") && t.M) parts.push(t.M); if (layout.includes("P") && t.P) parts.push(t.P); return [...new Set(parts)].join(" — "); }
  return t[k];
};
export function judge(tr, ocr) {
  const b = B.readScheduleSpans(tr.spans, { ocr }), h = H.readScheduleSpans(tr.spans, { ocr });
  if (!b.rows.length) return { counted: false, hRows: h.rows.length };
  if (JSON.stringify(b) === JSON.stringify(h)) return { counted: true, changed: false };
  const bad = []; let good = 0; let rowHard = 0; let baseBoxRight = true; let headBoxWrong = false;
  for (const br of b.rows) {
    let rowRight = true, rowBad = false;
    const hr = h.rows.find((r) => r.finish_tag === br.finish_tag && r.section === br.section);
    const t = tr.rows.find((r) => r.C === br.finish_tag);
    if (!t) continue;
    if (!hr) { bad.push(`${br.finish_tag}: row lost`); rowHard++; continue; }
    for (const k of ["M", "V", "K", "N"]) { if (k !== "M" && !tr.layout.includes(k)) continue; if (k === "M" && !tr.layout.includes("M") && !tr.layout.includes("P")) continue;
      const f = FIELD[k], want = truthOf(t, tr.layout, k);
      const bOk = br[f] === want, hOk = hr[f] === want;
      if (!bOk) { rowRight = false; baseBoxRight = false; } if (!hOk) headBoxWrong = true; if (bOk && !hOk) rowBad = true;
      if (bOk && !hOk) bad.push(`${br.finish_tag}.${f}: base "${br[f]}" -> head "${hr[f]}" (truth "${want}")`); if (!bOk && hOk) good++; }
    if (rowRight && rowBad) rowHard++;
    if (br.suggested !== hr.suggested && br.unticked_reason !== hr.unticked_reason) {
      const wantNU = /NOT USED/.test(t.N) && tr.layout.includes("N");
      if ((br.suggested === !wantNU) && hr.suggested !== br.suggested) bad.push(`${br.finish_tag}.suggested ${br.suggested}->${hr.suggested}`);
    }
  }
  return { counted: true, changed: true, bad, good, rowHard, boxHard: baseBoxRight && headBoxWrong };
}
if (process.argv[1].endsWith("fuzz4.mjs")) {
  const N = +(process.env.N ?? 500), AL = process.env.AL, NR = process.env.NR ? +process.env.NR : undefined, S0 = +(process.env.SEED0 ?? 1);
  const WORDS = process.env.WORDS !== "0", OCR = process.env.OCR !== "0";
  let n = 0, rowHardBoxes = 0, boxHard = 0, reg = 0, fixed = 0, changed = 0, partial = 0; const ex = [];
  for (let s = S0; s < S0 + N; s++) {
    const tr = trial(s, AL, NR, WORDS); const j = judge(tr, OCR);
    if (!j.counted) continue; n++; if (!j.changed) continue; changed++;
    if (j.rowHard) rowHardBoxes++; if (j.boxHard) boxHard++;
    if (j.bad.length) { reg++; if (j.good) partial++; if (ex.length < 6 && (j.rowHard || !process.env.HARDONLY)) ex.push({ seed: s, rowHard: j.rowHard, hdr: tr.hdr, widths: tr.widths, align: tr.align, bad: j.bad.slice(0, 4) }); }
    else if (j.good) fixed++;
  }
  console.log(JSON.stringify({ words: WORDS, ocr: OCR, AL: AL ?? "any", NR: NR ?? "2-6", N, readOnBase: n, changed, boxHard, rowHardBoxes, fieldRegBoxes: reg, fixed, changedNoFix: changed - reg - fixed }));
  for (const e of ex) console.log("  " + JSON.stringify(e));
}
