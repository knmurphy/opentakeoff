// Research probe (throwaway) — run: node --import tsx docs/evidence/one-click/research/<file>.mts
// Run from anywhere; paths are absolute to this checkout. Not part of `npm run bench`.
// Research probe (throwaway): what would RFC item F (batch fill) score TODAY,
// using the shipped detectRooms path, measured against the pinned corpus
// goldens? Also: how far apart are detectRegions' raw flood and the click
// path's sealed flood on the SAME seeds?
import { createRequire } from "module";
import { readFileSync } from "fs";
import { join } from "path";
import { extractVectorGeometry, buildMask, floodRegion, floodRegionSealed, sealRadiiFor, doorWedgeCapPx, minPassRadiusFor, traceRegion, MASK_MAX_DIM, SENS_BALANCED } from "../../../../web/src/lib/oneclick.ts";
import { roomLabelSeeds, detectRegions } from "../../../../web/src/lib/detectRooms.ts";
import { polyIoU } from "../../../../web/bench/score.ts";

const ROOT = "/home/user/opentakeoff";
const req = createRequire(import.meta.url);
const pdfjs = await import(req.resolve("/home/user/opentakeoff/web/node_modules/pdfjs-dist/legacy/build/pdf.mjs"));

const CASES = (process.env.ONLY ? [process.env.ONLY] : ["sample-plan", "va-finish-plan"]);

function areaSF(ring: number[][], pxPerFt: number): number {
  let a = 0;
  for (let i = 0; i < ring.length; i++) {
    const [x1, y1] = ring[i], [x2, y2] = ring[(i + 1) % ring.length];
    a += x1 * y2 - x2 * y1;
  }
  return Math.abs(a / 2) / (pxPerFt * pxPerFt);
}

for (const cname of CASES) {
  const c = JSON.parse(readFileSync(join(ROOT, "web/bench/corpus", cname + ".json"), "utf8"));
  const pdfPath = join(ROOT, "web/bench/corpus", c.pdf);
  const doc = await pdfjs.getDocument({ url: pdfPath, useSystemFonts: true }).promise;
  const page = await doc.getPage(c.page || 1);
  const vp = page.getViewport({ scale: c.scale });
  const ops = await page.getOperatorList();
  const g = extractVectorGeometry(ops, vp.transform, pdfjs.OPS);
  const tc = await page.getTextContent();
  const items: { str: string; x: number; y: number }[] = [];
  for (const it of (tc.items as any[])) {
    const s = it.str || "";
    if (!s.trim()) continue;
    const t = pdfjs.Util.transform(vp.transform, it.transform);
    items.push({ str: s, x: +t[4].toFixed(1), y: +t[5].toFixed(1) });
  }
  const baseDim = Math.min(MASK_MAX_DIM, Math.max(vp.width, vp.height, 2));
  const mo = buildMask(g.segs, vp.width, vp.height, baseDim, g.meta, c.ptPerFt);
  const mppf = (mo as any).ws * c.ptPerFt;
  const pxPerFt = c.ptPerFt;

  console.log(`\n================ ${cname} ================`);
  console.log(`viewport ${Math.round(vp.width)}x${Math.round(vp.height)} px · segs ${g.segs.length / 4} · text items ${items.length} · mask px/ft ${mppf.toFixed(2)}`);

  // ---- (1) label seeding: what does the batch path even find? ----
  const seeds = roomLabelSeeds(items);
  console.log(`roomLabelSeeds: ${seeds.length} room-number labels -> ${seeds.map((s) => s.str).slice(0, 40).join(",")}`);

  // ---- (2) shipped batch path: raw floodRegion, status-gated ----
  const detected = detectRegions(mo, seeds, SENS_BALANCED);
  console.log(`detectRegions (raw floodRegion, shipped): ${detected.length}/${seeds.length} clean regions kept`);

  // status histogram for raw vs sealed on the SAME seeds
  const hist = (rows: string[]) => {
    const m: Record<string, number> = {};
    for (const r of rows) m[r] = (m[r] || 0) + 1;
    return Object.entries(m).map(([k, v]) => `${k}:${v}`).join(" ");
  };
  const rawStatuses: string[] = [], sealedStatuses: string[] = [];
  const sealedRegions: { str: string; seed: [number, number]; ring: number[][]; sf: number }[] = [];
  const rawRegions: { str: string; seed: [number, number]; ring: number[][]; sf: number }[] = [];
  for (const s of seeds) {
    const fr = floodRegion(mo, s.seed[0], s.seed[1], SENS_BALANCED);
    rawStatuses.push(fr.status);
    if (fr.status === "ok") { const r = traceRegion(fr as any); if (r && r.length >= 3) rawRegions.push({ str: s.str, seed: s.seed, ring: r as any, sf: areaSF(r as any, pxPerFt) }); }
    const fs = floodRegionSealed(mo, s.seed[0], s.seed[1], SENS_BALANCED, sealRadiiFor(mppf), doorWedgeCapPx(mppf), minPassRadiusFor(mppf));
    sealedStatuses.push(fs.status);
    if (fs.status === "ok") { const r = traceRegion(fs as any); if (r && r.length >= 3) sealedRegions.push({ str: s.str, seed: s.seed, ring: r as any, sf: areaSF(r as any, pxPerFt) }); }
  }
  console.log(`  raw    statuses: ${hist(rawStatuses)}`);
  console.log(`  sealed statuses: ${hist(sealedStatuses)}`);

  // ---- (3) detection-grade metric vs the pinned goldens ----
  // recall: for each golden probe (expect=golden, not known-fail), is there a
  // detected region with IoU >= 0.5 / >= 0.9?
  const goldens = (c.probes as any[]).filter((p) => p.expect === "golden" && !p.knownFail);
  for (const [label, regions] of [["raw(shipped)", rawRegions], ["sealed(click-path parity)", sealedRegions]] as const) {
    let hit50 = 0, hit90 = 0;
    const detail: string[] = [];
    for (const gp of goldens) {
      let best = 0, bestStr = "-";
      for (const r of regions) {
        const i = polyIoU(r.ring as any, gp.golden, 8);
        if (i > best) { best = i; bestStr = r.str; }
      }
      if (best >= 0.5) hit50++;
      if (best >= 0.9) hit90++;
      detail.push(`${gp.name}: best IoU ${best.toFixed(3)} (label ${bestStr})`);
    }
    console.log(`  [${label}] room recall vs ${goldens.length} pinned goldens: IoU>=0.5 ${hit50}/${goldens.length} · IoU>=0.9 ${hit90}/${goldens.length}`);
    for (const d of detail) console.log(`      ${d}`);
  }

  // ---- (4) parity gap on the PINNED SEEDS (apples to apples with the bench) ----
  let rawSum = 0, sealSum = 0, n = 0, rawRef = 0;
  const rows: string[] = [];
  for (const p of (c.probes as any[])) {
    if (p.expect !== "golden") continue;
    const fr = floodRegion(mo, p.seed[0], p.seed[1], 0.5);
    const rr = fr.status === "ok" ? traceRegion(fr as any) : null;
    const iouRaw = rr && rr.length >= 3 ? polyIoU(rr as any, p.golden, 8) : 0;
    if (fr.status !== "ok") rawRef++;
    const fs = floodRegionSealed(mo, p.seed[0], p.seed[1], 0.5, sealRadiiFor(mppf), doorWedgeCapPx(mppf), minPassRadiusFor(mppf));
    const sr = fs.status === "ok" ? traceRegion(fs as any) : null;
    const iouSeal = sr && sr.length >= 3 ? polyIoU(sr as any, p.golden, 8) : 0;
    if (!p.knownFail) { rawSum += iouRaw; sealSum += iouSeal; n++; }
    rows.push(`      ${p.name.padEnd(26)} raw ${fr.status.padEnd(8)} IoU ${iouRaw.toFixed(3)}   sealed ${fs.status.padEnd(8)} IoU ${iouSeal.toFixed(3)}${p.knownFail ? "  [known-fail]" : ""}`);
  }
  console.log(`  [pinned seeds] mean IoU raw ${(rawSum / n).toFixed(3)} vs sealed ${(sealSum / n).toFixed(3)} over ${n} gating probes; raw refusals ${rawRef}`);
  for (const r of rows) console.log(r);
}
