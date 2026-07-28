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
import { extractVectorGeometry, buildMask, floodRegionSealed, sealRadiiFor, doorWedgeCapPx, minPassRadiusFor, traceRegion, MASK_MAX_DIM } from "../src/lib/oneclick.ts";
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
    note: "VA plan (1/8\" assumed): rooms visually reviewed in-browser (issue #184 rounds 2-4; re-reviewed round 8 for the periodicity classifier + polyline-arc door recognition). Includes drawn-door rooms, a dense-hatch toilet room, and the cloud-bounded corridor.",
    probes: [
      // Round-8 re-pin (item C): the patient room no longer annexes its
      // toilet room — the toilet's PT-tile floor is a different finish zone
      // that the OLD classifier's loose rhythm heuristic merged in by
      // accident (its dashed door arc classified as hatch, so the escalated
      // fill walked through the doorway). With arcs recognized as arcs, the
      // room reads to its own boundaries + entry wedge, and the toilet is
      // its own one-click probe (dense hatch, failure mode #1: the click
      // lands between cross-hatch lines and must measure, not refuse).
      { name: "patient-room-137", seed: [2592, 756], expect: "golden" as const, tags: ["door-swing"] },
      // The room has an inset finish-tag ANNOTATION RING (solid hairline
      // offset lines, 45° corner ties) that the engine cannot yet see past —
      // the room probe reads to the ring, and the perimeter band between
      // ring and wall is measurable only as its own click. This probe pins
      // the band's left strip so that floor is tracked, not lost; the
      // synthetic annotation-ring-room known-fail pins the wall-to-wall
      // intent. (Adversarial re-pin audit, round 8.)
      { name: "patient-room-137-band", seed: [2550, 900], expect: "golden" as const, tags: ["annotation-band"] },
      { name: "patient-toilet-137a", seed: [2668, 1112], expect: "golden" as const, tags: ["hatch", "dense-hatch-room"] },
      { name: "elevator-e01", seed: [2538, 1566], expect: "golden" as const, tags: ["door-swing"] },
      // ward room + its vestibule are TWO probes since the min-passage rule:
      // the old single 294 SF trace reached the vestibule only through a
      // sub-half-foot slit between an annotation leader tip and a wall corner
      // (a raster accident that flipped with resolution — bench round 7).
      // Deterministically they are two spaces behind a double door, clicked
      // separately; nothing the reviewer approved is lost, it's just two rows.
      // Round 8: the ward room's own double doors (polyline arcs, now
      // curve-recognized) unify — the click measures through the open pair,
      // both swing wedges included, down to the vestibule's swing arc; the
      // vestibule keeps the complementary side, so the two tile with no
      // overlap and no gap.
      { name: "ward-room-294sf", seed: [4050, 486], expect: "golden" as const, tags: ["door-swing"] },
      { name: "ward-vestibule", seed: [4045, 1230], expect: "golden" as const, tags: ["door-swing", "vestibule"] },
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
  const mo = buildMask(g.segs, vp.width, vp.height, MASK_MAX_DIM, g.meta, c.ptPerFt);
  const mppf = mo.ws * c.ptPerFt;
  const probes: object[] = [];
  for (const p of c.probes) {
    if (p.expect === "refusal") { probes.push(p); continue; }
    const f = floodRegionSealed(mo, p.seed[0], p.seed[1], 0.5, sealRadiiFor(mppf), doorWedgeCapPx(mppf), minPassRadiusFor(mppf));
    if (f.status !== "ok") { console.error(`  ${c.file} ${p.name}: engine refused (${f.status}) — cannot pin`); continue; }
    const ring = traceRegion(f).map(([x, y]) => [Math.round(x * 10) / 10, Math.round(y * 10) / 10]);
    probes.push({ ...p, golden: ring });
    console.log(`  ${c.file} ${p.name}: pinned ${ring.length} verts${f.wedges ? " (+swing)" : ""}${f.sealedPx ? ` (sealed@${f.sealedPx})` : ""}`);
  }
  const out = { pdf: c.pdf, scale: c.scale, ptPerFt: c.ptPerFt, note: c.note, pinnedAt: "reviewed traces, issue #184", probes };
  writeFileSync(join(here, "corpus", c.file), JSON.stringify(out, null, 1));
  console.log(`wrote corpus/${c.file}`);
}
