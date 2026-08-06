// A6 — do the batch and MCP surfaces measure with the same engine as the canvas?
//
// Three paths, one set of seeds, one sheet, one scale:
//   CANVAS      the inline call TakeoffCanvas.jsx makes at a One-Click:
//               buildMask(..., pxPerFt) then floodRegionSealed(mo, x, y, 0.5,
//               sealRadiiFor(mppf), doorWedgeCapPx(mppf), minPassRadiusFor(mppf)),
//               then snapVertices(traceRegion(f), nearestSnap(grid), 7).
//   detectRegions   web/src/lib/detectRooms.ts — the batch "Detect Rooms" path.
//   MCP         the real mcp/src/session.ts Session: loadPlan + set_scale +
//               one_click / detect_rooms. Reachable on both states.
//
// All three stamp origin.method "one_click_v1". This probe reports the area each
// returns for the same seed and flags every divergence.
import { createRequire } from "module";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import {
  extractVectorGeometry, buildMask, floodRegionSealed, sealRadiiFor, doorWedgeCapPx,
  minPassRadiusFor, traceRegion, snapVertices, ringArea, MASK_MAX_DIM, SENS_BALANCED,
} from "../src/lib/oneclick.ts";
import { roomLabelSeeds, detectRegions } from "../src/lib/detectRooms.ts";
import { buildSnapGrid, nearestSnap } from "../src/lib/geometry.js";
import { Session } from "../../mcp/src/session.ts";

const SNAP_CELL = 24, SNAP_TOL = 7, RS = 2;
const here = dirname(fileURLToPath(import.meta.url));
const req = createRequire(import.meta.url);
const pdfjs: any = await import(req.resolve("pdfjs-dist/legacy/build/pdf.mjs"));

// sheet under test: the demo plan the MCP test suite itself uses. 1/4" = 1'-0"
// ⇒ upp = 1/36 ft per image px at render scale 2 ⇒ pxPerFt 36.
const WHICH = process.argv[2] || "sample-plan";
const CFG: any = {
  "sample-plan": { pdf: "sample-plan.pdf", ptPerFt: 36, extraSeeds: [] },
  "sample-finish-plan": {
    pdf: "sample-finish-plan.pdf", ptPerFt: 18,
    // the bench corpus's own probe seeds — doors, hatch, gaps, a cloud boundary
    extraSeeds: [["patient-room-137", 2592, 756], ["patient-room-137-band", 2550, 900],
      ["patient-toilet-137a", 2668, 1112], ["elevator-e01", 2538, 1566], ["ward-room", 4050, 486],
      ["ward-vestibule", 4045, 1230], ["cloud-corridor", 1814, 1814], ["shaded-wing-office", 659, 1551]],
  },
}[WHICH];
const PDF = join(here, "..", "..", "demo", CFG.pdf);
const KEY = CFG.pdf;
const PT_PER_FT = CFG.ptPerFt, UPP = 1 / PT_PER_FT;

// ── CANVAS path ─────────────────────────────────────────────────────────────
const doc = await pdfjs.getDocument({ url: PDF, useSystemFonts: true }).promise;
const page = await doc.getPage(1);
const vp = page.getViewport({ scale: RS });
const ops = await page.getOperatorList();
const g = extractVectorGeometry(ops, vp.transform, pdfjs.OPS);
const mo = buildMask(g.segs, Math.ceil(vp.width), Math.ceil(vp.height), MASK_MAX_DIM, g.meta, PT_PER_FT, PT_PER_FT);
const mppf = mo.mppf || 0;
const grid = buildSnapGrid(g.points, SNAP_CELL);
const snap = (r: any) => snapVertices(traceRegion(r), (x: number, y: number, d: number) => nearestSnap(grid, x, y, d), SNAP_TOL);

// the seeds the batch detector itself finds, so all three paths use ONE seed set
const txt = await page.getTextContent();
const items = txt.items.map((it: any) => {
  const t = pdfjs.Util.transform(vp.transform, it.transform);
  return { str: it.str, x: t[4], y: t[5] };
});
const seeds = [...roomLabelSeeds(items), ...CFG.extraSeeds.map((e: any) => ({ str: e[0], seed: [e[1], e[2]] as [number, number] }))];

const kOf = (str: string, seed: number[]) => `${str}@${Math.round(seed[0])},${Math.round(seed[1])}`;
const canvas = seeds.map((s) => {
  const f: any = floodRegionSealed(mo, s.seed[0], s.seed[1], SENS_BALANCED, sealRadiiFor(mppf), doorWedgeCapPx(mppf), minPassRadiusFor(mppf));
  if (f.status !== "ok") return { key: kOf(s.str, s.seed), label: s.str, status: f.status };
  const ring = snap(f);
  return { key: kOf(s.str, s.seed), label: s.str, status: "ok", area_sf: +(ringArea(ring) * UPP * UPP).toFixed(2), nverts: ring.length, count: f.count, sealedPx: f.sealedPx ?? null, wedges: f.wedges ?? null };
});

// ── detectRegions path ──────────────────────────────────────────────────────
const det = detectRegions(mo, seeds).map((r: any) => {
  const ring = snap(r.flood);
  return { key: kOf(r.str, r.seed), label: r.str, status: "ok", area_sf: +(ringArea(ring) * UPP * UPP).toFixed(2), nverts: ring.length, count: r.flood.count, sealedPx: r.flood.sealedPx ?? null, wedges: r.flood.wedges ?? null };
});

// ── MCP path (the real Session) ─────────────────────────────────────────────
const sess = new Session();
await sess.loadPlan(PDF);
sess.setScale(KEY, { upp: UPP });
const mcpDetect: any = await sess.detectRooms(KEY, { role: "floor_area", returnVerts: false });
const mcpOne: any[] = [];
for (const s of seeds) {
  try {
    const r = await sess.oneClick(KEY, s.seed[0], s.seed[1], { role: "floor_area", returnVerts: false });
    mcpOne.push({ key: kOf(s.str, s.seed), label: s.str, status: "ok", area_sf: r.area_sf, nverts: r.nverts, confidence: r.confidence ?? null, gap_sealed_px: r.gap_sealed_px ?? null, door_wedges: r.door_wedges ?? null });
  } catch (e: any) { mcpOne.push({ key: kOf(s.str, s.seed), label: s.str, status: "refused", why: String(e.message || e) }); }
}
// the mask the MCP session actually built — does it carry the sheet scale?
const mcpMask: any = await sess.ensureMask(KEY);

const byKey = (rows: any[]) => Object.fromEntries(rows.map((r) => [r.key, r]));
const cM = byKey(canvas), dM = byKey(det), oM = byKey(mcpOne);
// mcp detect_rooms finds its own seeds from its own text extraction — match by
// label AND nearest seed so an unrelated duplicate label can not be paired
const mcpRooms: any[] = mcpDetect.rooms;
const labelCount: Record<string, number> = {};
for (const r of mcpRooms) labelCount[r.label] = (labelCount[r.label] || 0) + 1;
const keys = [...new Set([...Object.keys(cM), ...Object.keys(dM), ...Object.keys(oM)])].sort();
const rows = keys.map((k) => {
  const lbl = (cM[k] || dM[k] || oM[k]).label;
  // only pair with mcp detect_rooms when that label is UNAMBIGUOUS on its side
  const mr = labelCount[lbl] === 1 ? mcpRooms.find((r) => r.label === lbl) : undefined;
  const canvasV = cM[k]?.area_sf ?? cM[k]?.status;
  const cmp = [
    ["detectRegions", dM[k] ? dM[k].area_sf : "refused"],
    ["mcp_one_click", oM[k] ? (oM[k].area_sf ?? oM[k].status) : "-"],
    ...(mr ? [["mcp_detect_rooms", mr.area_sf]] as any : []),
  ] as Array<[string, any]>;
  const norm = (v: any) => (v === "leak" || v === "tiny" || v === "boundary" || v === "refused" ? "refused" : v);
  const disagreeWith = cmp.filter(([, v]) => norm(v) !== norm(canvasV)).map(([n]) => n);
  return {
    key: k, label: lbl,
    canvas_sf: canvasV,
    detectRegions_sf: dM[k] ? dM[k].area_sf : "refused",
    mcp_one_click_sf: oM[k] ? (oM[k].area_sf ?? oM[k].status) : "-",
    mcp_detect_rooms_sf: mr ? mr.area_sf : "(no unambiguous pairing)",
    agree: disagreeWith.length === 0, disagreeWith,
  };
});

console.log(JSON.stringify({
  probe: "A6", sheet: KEY, which: WHICH, upp: UPP, canvasMaskMppf: mppf,
  mcpMaskMppf: mcpMask?.mppf ?? 0, mcpMaskCarriesScale: !!(mcpMask?.mppf),
  seedsFound: seeds.length, rows,
  divergences: rows.filter((r) => !r.agree).length,
  mcpOneClickReceipts: mcpOne,
}, null, 1));
