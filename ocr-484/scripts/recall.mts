// G1 scoring: the #486/#471 search-recall method (adapted from that session's recall.mts, same formulas).
// Key: pageTextIndex on the vector demo sheets (rs 2). OCR: ocrSheetIndex over the page read's lines (rs-2 px).
// Coverage = distinct key terms per sheet present in the OCR index, pooled over (sheet, term).
// Usage: node --import tsx recall.mts <results/g1.json> <out.json>
import { readFileSync, writeFileSync } from "node:fs";
import * as pdfjs from "__WEB__/node_modules/pdfjs-dist/legacy/build/pdf.mjs";
import { pageTextIndex } from "__WEB__/src/lib/pageTextIndex.ts";
import { ocrSheetIndex } from "__WEB__/src/lib/planSearch.ts";
import { buildSheetIndex, isCode, TAG_RE, ROOM_RE } from "__WEB__/src/lib/planIndex.ts";
import { extractRegionText } from "__WEB__/src/lib/sheets.ts";
const [inp, outp] = process.argv.slice(2);
const res = JSON.parse(readFileSync(inp, "utf8"));
const doc = await pdfjs.getDocument({ data: new Uint8Array(readFileSync("__WEB__/public/demo/sample-finish-plan.pdf")), isEvalSupported: false }).promise;
const pct = (a: number, b: number) => (b ? Math.round((1000 * a) / b) / 10 : null);
const keys: Record<number, any> = {};
for (const p of [1, 2]) {
  const page = await doc.getPage(p); const vp = page.getViewport({ scale: 2 }); const tc = await page.getTextContent();
  const key = pageTextIndex("v" + p, tc as never, vp as never);
  const runs = extractRegionText(tc as never, vp as never, { x0: 0, y0: 0, x1: vp.width, y1: vp.height });
  const level = buildSheetIndex("l", runs.filter((t: any) => Math.round(t.ang ?? 0) % 360 === 0)).terms;
  keys[p] = { key, level };
}
const dupes = (ls: any[]) => { const out: string[] = []; for (let i = 0; i < ls.length; i++) for (let j = i + 1; j < ls.length; j++) { const a = ls[i], b = ls[j]; if (a.str.replace(/\s/g, "") === b.str.replace(/\s/g, "") && a.x < b.x + b.w && b.x < a.x + a.w && a.y - a.h < b.y && b.y - b.h < a.y) out.push(a.str); } return out; };
const result: any = {};
for (const cfg of [...new Set(res.runs.map((r: any) => r.cfg))] as string[]) {
  const tot = { key: 0, hit: 0, keyLevel: 0, hitLevel: 0, codeKey: 0, codeHit: 0, tagKey: 0, tagHit: 0, roomKey: 0, roomHit: 0, ocr: 0, ocrFalse: 0 };
  const per: any[] = [];
  for (const r of res.runs.filter((x: any) => x.cfg === cfg)) {
    const { key, level } = keys[r.sheet];
    const ocr = ocrSheetIndex("o" + r.sheet, r.linesPx);
    const K = Object.keys(key.terms), O = new Set(Object.keys(ocr.terms)), KS = new Set(K);
    const hit = K.filter((t) => O.has(t)), KL = K.filter((t) => t in level), hitL = KL.filter((t) => O.has(t));
    const code = K.filter(isCode), tag = K.filter((t) => TAG_RE.test(t)), room = K.filter((t) => ROOM_RE.test(t));
    const fal = [...O].filter((t) => !KS.has(t));
    per.push({ sheet: r.sheet, ms: r.totalMs, tiles: r.tiles, rasters: r.nRasters, lines: r.linesPx.length, clipped: r.clipped, clippedLines: r.linesPx.filter((l: any) => l.clipped).map((l: any) => l.str), doubled: dupes(r.linesPx),
      keyTerms: K.length, found: hit.length, coveragePct: pct(hit.length, K.length), levelCoveragePct: pct(hitL.length, KL.length),
      tags: tag.filter((t) => O.has(t)).length + "/" + tag.length, rooms: room.filter((t) => O.has(t)).length + "/" + room.length, codes: code.filter((t) => O.has(t)).length + "/" + code.length,
      ocrTerms: O.size, falseTerms: fal.length, falseRatePct: pct(fal.length, O.size), falseList: fal, missTags: tag.filter((t) => !O.has(t)), missList: K.filter((t) => !O.has(t)) });
    Object.assign(tot, { key: tot.key + K.length, hit: tot.hit + hit.length, keyLevel: tot.keyLevel + KL.length, hitLevel: tot.hitLevel + hitL.length, codeKey: tot.codeKey + code.length, codeHit: tot.codeHit + code.filter((t) => O.has(t)).length,
      tagKey: tot.tagKey + tag.length, tagHit: tot.tagHit + tag.filter((t) => O.has(t)).length, roomKey: tot.roomKey + room.length, roomHit: tot.roomHit + room.filter((t) => O.has(t)).length, ocr: tot.ocr + O.size, ocrFalse: tot.ocrFalse + fal.length });
  }
  result[cfg] = { overall: { coveragePct: pct(tot.hit, tot.key), found: tot.hit + "/" + tot.key, levelOnlyCoveragePct: pct(tot.hitLevel, tot.keyLevel), tags: tot.tagHit + "/" + tot.tagKey, rooms: tot.roomHit + "/" + tot.roomKey, roomPct: pct(tot.roomHit, tot.roomKey), codes: tot.codeHit + "/" + tot.codeKey, falseTerms: tot.ocrFalse + "/" + tot.ocr, falseRatePct: pct(tot.ocrFalse, tot.ocr) }, perSheet: per };
  console.log(cfg, JSON.stringify(result[cfg].overall));
  for (const s of per) console.log("  sheet", s.sheet, JSON.stringify({ ms: s.ms, tiles: s.tiles, rasters: s.rasters, lines: s.lines, clipped: s.clippedLines, doubled: s.doubled, cov: s.coveragePct, level: s.levelCoveragePct, tags: s.tags, rooms: s.rooms, false: s.falseTerms + " (" + s.falseRatePct + "%)", missTags: s.missTags }));
}
writeFileSync(outp, JSON.stringify(result, null, 1));
