// BASE and HEAD: paths to two checkouts' web/ folders, e.g. BASE=../main/web HEAD=../branch/web node --import tsx <this file>
// Extended attack fuzz against 231fd8c0. Features random per trial unless forced by env:
// AL=left|center|right|mixed  WRAP=p  NOTESBLK=p  STACK=p  OVERFLOW=p  NARROW=p (narrow alias col with wide header text)  HJ=header jitter px
const H = await import(process.env.HEAD + "/src/lib/scheduleRead.ts");
const B = await import(process.env.BASE + "/src/lib/scheduleRead.ts");
const mulberry = (a) => () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const MATS = ["RESILIENT FLOOR", "CERAMIC TILE", "RUBBER BASE", "CARPET TILE", "SEALED CONCRETE", "PORCELAIN TILE", "LVT", "RUBBER WALL BASE"];
const VENS = ["VENDOR-A", "VENDOR A", "ACME FLOORS", "GRAY CO", "TRANSITIONS INC", "BLUE RIDGE TILE CO", "VENDOR-T"];
const COLS = ["GRAY", "BLUE", "WARM WHITE", "BLACK", "SLATE", "COOL GRAY 2"];
const NOTES = ["ZONE-A", "SEE A-501", "ALL FLOORS", "NOT USED", "BY OWNER", "N.I.C."];
const SPECS = ["09 65 13", "09 30 00", "096813"];
const FIELD = { M: "description", V: "manufacturer", K: "spec_color", N: "remarks" };
const LAYOUTS = [
  ["C","M","V","K","N"], ["C","M","K","V","N"], ["C","V","M","K"], ["C","M","K","N","V"], ["C","M","K","V"], ["C","M","K","NX"],
  ["C","M","V","P","K"], ["C","M","K","V","NX"], ["C","M","P","K"], ["C","M","P"], ["C","P","M","K"], ["C","M","V","NX"],
  ["C","M","V","NX","K"], ["C","V","P","M","K"], ["C","M","K","P","V","NX"],
];
const env = (k, d) => (process.env[k] !== undefined ? +process.env[k] : d);
export function trial(seed, o = {}) {
  const rnd = mulberry(seed * 2654435761 + 11);
  const pick = (a) => a[Math.floor(rnd() * a.length)];
  const j = (m) => (rnd() * 2 - 1) * m;
  const words = o.words ?? true;
  const alias = pick(["MFG", "MFR"]);
  const layout = pick(LAYOUTS);
  const nName = pick(["REMARKS", "NOTES"]);
  const pName = pick(["SPEC", "SPECIFICATION", "SPECS"]);
  const hdrName = { C: "CODE", M: "MATERIAL", V: alias, K: "COLOR", N: nName, NX: "NOTES", P: pName };
  const key = (k) => k[0];
  const cw = 5 + rnd() * 2;
  const narrowP = o.NARROW ?? 0.3;
  const widths = layout.map((k) => { const isAlias = ["V","NX","P"].includes(k) || (k === "N" && nName === "NOTES");
    if (key(k) === "C") return 60 + rnd() * 40; if (isAlias && rnd() < narrowP) return 45 + rnd() * 40; return 90 + rnd() * 220; });
  const AL = o.AL ?? pick(["left", "center", "right", "mixed"]);
  const nr = o.NR ?? (2 + Math.floor(rnd() * 5));
  const fill = { V: rnd(), N: rnd(), P: rnd() };
  const wrapP = o.WRAP ?? 0.15, ovP = o.OVERFLOW ?? 0.1, hj = o.HJ ?? 3;
  const mkRows = (base, n) => Array.from({ length: n }, (_, i) => ({ C: `${pick(["FL", "TL", "RB", "CPT"])}-${base + i + 1}`, M: pick(MATS), V: rnd() < fill.V ? pick(VENS) : "", K: pick(COLS), N: rnd() < fill.N ? pick(NOTES) : "", P: rnd() < fill.P ? pick(SPECS) : "" }));
  if (o.HFIT !== undefined) layout.forEach((k, i) => { const hw = hdrName[k].length * cw + 2 * o.HFIT; if (widths[i] < hw) widths[i] = hw; });
  let x = 40; const xs = widths.map((w) => { const a = x; x += w; return a; });
  const tableRight = x;
  const spans = [];
  const emitLine = (str, x0, ytop, hh) => {
    const h = hh ?? 8 + rnd() * 4;
    if (!words) { spans.push({ str, x: x0 + j(2), y: ytop + j(2), w: str.length * cw + j(2), h, rot: 0 }); return; }
    let cx = x0;
    for (const w of str.split(" ")) { const ww = w.length * cw; spans.push({ str: w, x: cx + j(2), y: ytop + j(2), w: Math.max(3, ww + j(2)), h, rot: 0 }); cx += ww + cw * (0.5 + rnd() * 0.6); }
  };
  const all = [];
  let y = 30;
  const tables = rnd() < (o.STACK ?? 0.15) ? 2 : 1;
  for (let t = 0; t < tables; t++) {
    emitLine(t ? "FINISH SCHEDULE - LEVEL 2" : "FINISH SCHEDULE", 40, y); y += 40;
    layout.forEach((k, i) => { const s = hdrName[k]; const hh = 8 + rnd() * (4 + hj); emitLine(s, xs[i] + (widths[i] - s.length * cw) / 2 + j(hj), y + j(hj), hh); });
    y += 30;
    const rows = mkRows(t * 10, nr);
    rows.forEach((r) => {
      let extraLine = false;
      layout.forEach((k, i) => { const kk = key(k); const v = r[kk]; if (!v) return;
        const a = AL === "mixed" ? pick(["left", "center", "right"]) : AL;
        const w = v.length * cw;
        const fits = w <= widths[i] - 8;
        const parts = v.split(" ");
        if (!fits && parts.length > 1 && rnd() < 0.7) { // wrap onto two lines
          const l1 = parts.slice(0, -1).join(" "), l2 = parts.at(-1);
          if (l1.length * cw > widths[i] - 8) { r[kk] = ""; return; }
          emitLine(l1, xs[i] + 4, y); emitLine(l2, xs[i] + 4, y + 11); extraLine = true; return; }
        if (!fits && !(rnd() < ovP)) { r[kk] = ""; return; }
        if (fits && parts.length > 1 && rnd() < wrapP) { const l1 = parts.slice(0, -1).join(" "), l2 = parts.at(-1);
          const xx = a === "left" ? xs[i] + 4 : a === "right" ? xs[i] + widths[i] - 4 - l1.length * cw : xs[i] + (widths[i] - l1.length * cw) / 2;
          const x2 = a === "left" ? xs[i] + 4 : a === "right" ? xs[i] + widths[i] - 4 - l2.length * cw : xs[i] + (widths[i] - l2.length * cw) / 2;
          emitLine(l1, xx, y); emitLine(l2, x2, y + 11); extraLine = true; return; }
        const xx = !fits ? xs[i] + 4 : a === "left" ? xs[i] + 4 : a === "right" ? xs[i] + widths[i] - 4 - w : xs[i] + (widths[i] - w) / 2;
        emitLine(v, xx, y); });
      y += extraLine ? 30 : 24;
    });
    all.push(...rows);
    y += 30;
  }
  if (rnd() < (o.NOTESBLK ?? 0.2)) { const nx = tableRight + 15 + rnd() * 60; emitLine("GENERAL NOTES:", nx, 70 + j(3)); emitLine("1. SEE SPEC FOR TAG", nx, 100); emitLine("2. ALL FINISHES BY OWNER", nx, 124); }
  return { spans, rows: all, layout: layout.map(key), hdr: layout.map((k) => hdrName[k]).join("|"), widths: widths.map(Math.round), AL, nr, tables };
}
const truthOf = (t, layout, k) => {
  if (k === "M") { const parts = []; if (layout.includes("M") && t.M) parts.push(t.M); if (layout.includes("P") && t.P) parts.push(t.P); return [...new Set(parts)].join(" — "); }
  return t[k];
};
export function judge(tr, ocr) {
  const b = B.readScheduleSpans(tr.spans, { ocr }), h = H.readScheduleSpans(tr.spans, { ocr });
  const bs = JSON.stringify(b), hs = JSON.stringify(h);
  if (!b.rows.length) return { counted: false, zeroChanged: bs !== hs };
  if (bs === hs) return { counted: true, changed: false };
  const bad = []; let good = 0, rowHard = 0, baseBoxRight = true, headBoxWrong = false, otherKeys = [];
  for (const br of b.rows) {
    const hr = h.rows.find((r) => r.finish_tag === br.finish_tag && r.section === br.section);
    const t = tr.rows.find((r) => r.C === br.finish_tag);
    if (!t) { baseBoxRight = false; continue; }
    if (!hr) { bad.push(`${br.finish_tag}: row lost`); rowHard++; continue; }
    let rowRight = true, rowBad = false;
    for (const k of ["M", "V", "K", "N"]) {
      if (k !== "M" && !tr.layout.includes(k)) continue; if (k === "M" && !tr.layout.includes("M") && !tr.layout.includes("P")) continue;
      const f = FIELD[k], want = truthOf(t, tr.layout, k), bOk = br[f] === want, hOk = hr[f] === want;
      if (!bOk) { rowRight = false; baseBoxRight = false; } if (!hOk) headBoxWrong = true;
      if (bOk && !hOk) { rowBad = true; bad.push(`${br.finish_tag}.${f}: "${br[f]}" -> "${hr[f]}" (truth "${want}")`); } if (!bOk && hOk) good++;
    }
    for (const k of ["category", "category_source", "suggested", "unticked_reason", "section", "style", "size"]) if (JSON.stringify(br[k]) !== JSON.stringify(hr[k])) {
      // category/suggested change when text is unchanged-correct counts as bad
      const textSame = ["description", "manufacturer", "spec_color", "remarks"].every((f) => br[f] === hr[f]);
      otherKeys.push(`${br.finish_tag}.${k}:${JSON.stringify(br[k])}->${JSON.stringify(hr[k])}${textSame ? " (text same)" : ""}`);
      if (textSame || rowRight) { rowBad = true; bad.push(otherKeys.at(-1)); }
    }
    if (rowRight && rowBad) rowHard++;
  }
  return { counted: true, changed: true, bad, good, rowHard, boxHard: baseBoxRight && (headBoxWrong || bad.length > 0), anyChangeOnRightBox: baseBoxRight, otherKeys };
}
if (process.argv[1].endsWith("fuzz5.mjs")) {
  const N = env("N", 500), S0 = env("SEED0", 1);
  const o = { words: process.env.WORDS !== "0" };
  for (const k of ["HFIT", "NR", "WRAP", "NOTESBLK", "STACK", "OVERFLOW", "NARROW", "HJ"]) if (process.env[k] !== undefined) o[k] = +process.env[k];
  if (process.env.AL) o.AL = process.env.AL;
  const OCR = process.env.OCR !== "0";
  let n = 0, rowHardBoxes = 0, boxHard = 0, reg = 0, fixed = 0, changed = 0, rightBoxChanged = 0, zeroChanged = 0; const ex = [];
  for (let s = S0; s < S0 + N; s++) {
    const tr = trial(s, o); const jd = judge(tr, OCR);
    if (!jd.counted) { if (jd.zeroChanged) zeroChanged++; continue; } n++; if (!jd.changed) continue; changed++;
    if (jd.anyChangeOnRightBox) rightBoxChanged++;
    if (jd.rowHard) rowHardBoxes++; if (jd.boxHard) boxHard++;
    if (jd.bad.length) { reg++; if (ex.length < 6) ex.push({ seed: s, hdr: tr.hdr, widths: tr.widths, AL: tr.AL, tables: tr.tables, bad: jd.bad.slice(0, 4) }); }
    else if (jd.good) fixed++;
  }
  console.log(JSON.stringify({ words: o.words, ocr: OCR, opts: o, N, readOnBase: n, zeroRowChanged: zeroChanged, changed, rightBoxChanged, boxHard, rowHardBoxes, fieldRegBoxes: reg, fixed }));
  for (const e of ex) console.log("  " + JSON.stringify(e));
}
