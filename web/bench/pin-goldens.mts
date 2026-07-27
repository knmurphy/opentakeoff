// One-off tool: pin golden polygons for REAL-PDF corpus cases from the current
// engine trace, after the trace has been visually reviewed (issue #184 rounds
// 2–4). Synthetic cases carry goldens by construction; real plans need a human
// in the loop once — this freezes what was reviewed so regressions surface as
// IoU drops. Regenerate deliberately, never casually:
//   node --import tsx bench/pin-goldens.mts
import { createRequire } from "module";
import { writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { extractVectorGeometry, buildMask, floodRegionSealed, sealRadiiFor, doorWedgeCapPx, traceRegion, MASK_MAX_DIM } from "../src/lib/oneclick.ts";
const req = createRequire(import.meta.url);
const pdfjs = await import(req.resolve("pdfjs-dist/legacy/build/pdf.mjs"));
const here = dirname(fileURLToPath(import.meta.url));

// Coordinates are image px at the pinned scale below. Probes chosen and
// reviewed on screen — see docs/evidence/one-click/ for the captures.
const PINNED = [
  {
    file: "sample-plan.json", pdf: "../../demo/sample-plan.pdf", scale: 2, ptPerFt: 18 * 2,
    note: "4 identical quadrant rooms; traces reviewed as exact rectangles (issue #184 round 3)",
    probes: [
      { name: "break-103", seed: [432, 216], expect: "golden" as const },
      { name: "corridor-104", seed: [1296, 216], expect: "golden" as const },
      { name: "office-101", seed: [432, 864], expect: "golden" as const },
      { name: "office-102", seed: [1296, 864], expect: "golden" as const },
    ],
  },
  {
    file: "va-finish-plan.json", pdf: "../../demo/sample-finish-plan.pdf", scale: 2, ptPerFt: 9 * 2,
    note: "VA plan (1/8\" assumed): rooms visually reviewed in-browser (issue #184 rounds 2-4). Includes drawn-door rooms and the cloud-bounded corridor.",
    probes: [
      { name: "patient-room-137", seed: [2592, 756], expect: "golden" as const, tags: ["door-swing"] },
      { name: "elevator-e01", seed: [2538, 1566], expect: "golden" as const, tags: ["door-swing"] },
      { name: "ward-room-294sf", seed: [4050, 486], expect: "golden" as const, tags: ["door-swing"] },
      { name: "cloud-corridor", seed: [1814, 1814], expect: "golden" as const, tags: ["cloud-boundary", "corridor"] },
      { name: "shaded-wing-office", seed: [659, 1551], expect: "golden" as const, tags: ["shaded-wing"] },
      { name: "open-margin", seed: [5443, 3737], expect: "refusal" as const, tags: ["sheet-margin", "known-limit"], knownFail: true },
    ],
  },
];

for (const c of PINNED) {
  const doc = await pdfjs.getDocument({ url: join(here, c.pdf), useSystemFonts: true }).promise;
  const page = await doc.getPage(1);
  const vp = page.getViewport({ scale: c.scale });
  const ops = await page.getOperatorList();
  const g = extractVectorGeometry(ops, vp.transform, pdfjs.OPS);
  const mo = buildMask(g.segs, vp.width, vp.height, MASK_MAX_DIM, g.meta);
  const mppf = mo.ws * c.ptPerFt;
  const probes: object[] = [];
  for (const p of c.probes) {
    if (p.expect === "refusal") { probes.push(p); continue; }
    const f = floodRegionSealed(mo, p.seed[0], p.seed[1], 0.5, sealRadiiFor(mppf), doorWedgeCapPx(mppf));
    if (f.status !== "ok") { console.error(`  ${c.file} ${p.name}: engine refused (${f.status}) — cannot pin`); continue; }
    const ring = traceRegion(f).map(([x, y]) => [Math.round(x * 10) / 10, Math.round(y * 10) / 10]);
    probes.push({ ...p, golden: ring });
    console.log(`  ${c.file} ${p.name}: pinned ${ring.length} verts${f.wedges ? " (+swing)" : ""}${f.sealedPx ? ` (sealed@${f.sealedPx})` : ""}`);
  }
  const out = { pdf: c.pdf, scale: c.scale, ptPerFt: c.ptPerFt, note: c.note, pinnedAt: "reviewed traces, issue #184", probes };
  writeFileSync(join(here, "corpus", c.file), JSON.stringify(out, null, 1));
  console.log(`wrote corpus/${c.file}`);
}
