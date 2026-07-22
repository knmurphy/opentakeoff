// One-Click accuracy replay harness (#173, epic #171).
//
// Reruns every synthetic corpus fixture through the REAL pure engine
// (buildMask → floodRegion → traceRegion), scores each accept case with
// polyscore's band against its golden, and FAILS on a per-case regression.
// Adding a fixture + its baseline requires no change here.
//
// SCOPE GUARD: this measures per-room TRACE ACCURACY (how close the trace is to
// a known room's accepted extent), NOT room detection (retired, #81). The
// synthetic bucket proves the segs→region→trace core is internally consistent
// and does not regress on the named failure modes; it does NOT prove real-plan
// accuracy or that the classifier tolerances match real CAD — that is the real
// demo-sheet bucket (#174).
//
// The gate is DELTA-vs-committed-baseline, not an absolute floor: band carries a
// deterministic grid-quantization + inset bias that the baseline freezes, so a
// regression is a visible number change and LOWERING a baseline is a reviewable
// edit to baseline.json (not a constant buried in a test). A coarse absolute
// backstop catches gross breakage. Known engine limitations (FM2 breach, the
// column over-count) are PINNED as characterizations, excluded from the accuracy
// aggregates, and flip loudly when the behavior changes (a fix or a regression).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { buildMask, floodRegion, traceRegion } from "../src/lib/oneclick.ts";
import { score, type Ring } from "../src/lib/polyscore.ts";
import { SYNTHETIC_FIXTURES, type CorpusCase, type CorpusFixture } from "./corpus/fixtures.ts";

const baseline: Record<string, { band: number; iou: number }> = JSON.parse(
  readFileSync(fileURLToPath(new URL("./corpus/baseline.json", import.meta.url)), "utf8"),
);

// ── committed gate constants (edits are reviewable) ─────────────────────────
const BAND_TOL = (b: number) => Math.max(0.1, 0.03 * b);   // per-case delta tolerance
const BAND_ABS_BACKSTOP = 3;                               // gross-breakage catch for clean accepts (mask px)
const KNOWN_LIMITATION_MAX = 1;                            // door-gap; only-ever-shrinking
const ACCEPT_RATE_MIN = 1.0;                               // every clean accept case must accept
const NO_BLEED_MAX_FRAC = 0.05;                            // traced region may cover <5% of a forbidden room

function goldenRings(g: CorpusCase["golden"]): Ring[] {
  if (!g || g.length === 0) return [];
  // single Ring: g[0] is a Point (a 2-number array). Ring[]: g[0] is a Ring
  // (an array of Points), so g[0][0] is itself an array.
  return Array.isArray(g[0][0]) ? (g as Ring[]) : [g as Ring];
}
const key = (fx: CorpusFixture, c: CorpusCase) => `${fx.id} :: ${c.label}`;

// ── one pass over the whole corpus, collected once ──────────────────────────
interface Row { fx: CorpusFixture; c: CorpusCase; k: string; status: string; band?: number; iou?: number; hatchFiltered?: boolean; tier?: string; bleedFrac?: number; }
const rows: Row[] = [];
for (const fx of SYNTHETIC_FIXTURES) {
  const { segs, meta } = fx.build();
  const mask = buildMask(segs, fx.imgW, fx.imgH, 3000, meta);
  for (const c of fx.cases) {
    const f = floodRegion(mask, c.seed[0], c.seed[1]);
    const row: Row = { fx, c, k: key(fx, c), status: f.status };
    if (f.status === "ok") {
      row.hatchFiltered = !!f.hatchFiltered;
      row.tier = f.tier;
      const gold = goldenRings(c.golden);
      if (gold.length) {
        const ring = traceRegion(f);
        const s = score([ring], gold);
        row.band = s.band; row.iou = s.iou;
        if (c.noBleedInto) {
          const nb = score([ring], [c.noBleedInto]);
          row.bleedFrac = nb.goldenArea > 0 ? nb.interArea / nb.goldenArea : 0;
        }
      }
    }
    rows.push(row);
  }
}

const accepts = rows.filter((r) => r.c.expect.kind === "accept");
const cleanAccepts = accepts.filter((r) => !r.c.knownDefect);   // the accuracy set
const knownDefects = rows.filter((r) => r.c.knownDefect);
const refuses = rows.filter((r) => r.c.expect.kind === "refuse");

// ── per-case assertions ─────────────────────────────────────────────────────
for (const r of rows) {
  test(`corpus: ${r.k}`, () => {
    if (r.c.expect.kind === "refuse") {
      assert.equal(r.status, r.status === r.c.expect.reason ? r.status : r.c.expect.reason,
        `expected refuse "${r.c.expect.reason}", got "${r.status}"`);
      return;
    }
    // accept
    assert.equal(r.status, "ok", `expected an ok fill, got "${r.status}"`);
    if (r.c.expectHatchFiltered !== undefined) {
      assert.equal(r.hatchFiltered, r.c.expectHatchFiltered, `hatchFiltered mismatch`);
    }
    if (r.c.expectTier) assert.equal(r.tier, r.c.expectTier, `tier mismatch: expected ${r.c.expectTier}, got ${r.tier}`);

    const base = baseline[r.k];
    assert.ok(base, `no committed baseline for "${r.k}" — run test/corpus/record.ts`);
    if (r.band === undefined) return;

    if (r.c.knownDefect) {
      // characterization: pin BOTH sides so a fix (band drops) or a regression
      // (band grows) both surface for a conscious baseline update.
      assert.ok(Math.abs(r.band - base.band) <= BAND_TOL(base.band),
        `known-defect band drifted: ${r.band.toFixed(3)} vs baseline ${base.band} (${r.c.knownDefect})`);
      return;
    }
    // clean accept: one-sided delta gate (improvements are allowed silently) + backstop
    assert.ok(r.band <= base.band + BAND_TOL(base.band),
      `band regressed: ${r.band.toFixed(3)} > baseline ${base.band} + tol`);
    assert.ok(r.band <= BAND_ABS_BACKSTOP,
      `band ${r.band.toFixed(3)} exceeds the absolute backstop ${BAND_ABS_BACKSTOP} (gross breakage or an over-high baseline)`);
    if (r.bleedFrac !== undefined) {
      assert.ok(r.bleedFrac <= NO_BLEED_MAX_FRAC,
        `trace bled ${(r.bleedFrac * 100).toFixed(1)}% into a forbidden room (max ${NO_BLEED_MAX_FRAC * 100}%)`);
    }
  });
}

// ── aggregate gates + scorecard ─────────────────────────────────────────────
test("corpus aggregates: accept-rate, refuse-rate, known-limitation count, band distribution", () => {
  const acceptRate = accepts.filter((r) => r.status === "ok").length / Math.max(1, accepts.length);
  assert.ok(acceptRate >= ACCEPT_RATE_MIN,
    `accept-rate ${acceptRate.toFixed(3)} < ${ACCEPT_RATE_MIN} — a case that should trace now refuses (got more cowardly)`);

  const refusing = refuses.filter((r) => r.status === (r.c.expect.kind === "refuse" ? r.c.expect.reason : "")).length;
  assert.equal(refusing, refuses.length, "a refuse case stopped refusing (silent over-fill)");

  const knownLimitations = refuses.filter((r) => r.c.golden === null).length;
  assert.ok(knownLimitations <= KNOWN_LIMITATION_MAX,
    `known-limitation refuses ${knownLimitations} > committed ${KNOWN_LIMITATION_MAX} (the list may only shrink)`);

  const bands = cleanAccepts.map((r) => r.band!).filter((b) => b !== undefined).sort((a, b) => a - b);
  const worst = bands[bands.length - 1];
  const p90 = bands[Math.min(bands.length - 1, Math.ceil(0.9 * bands.length) - 1)];
  const mean = bands.reduce((s, b) => s + b, 0) / Math.max(1, bands.length);
  assert.ok(worst <= BAND_ABS_BACKSTOP, `worst clean-accept band ${worst?.toFixed(3)} exceeds backstop ${BAND_ABS_BACKSTOP}`);

  // ── scorecard (scope-labeled so the number is never read as plan accuracy) ──
  const L: string[] = [];
  L.push("");
  L.push("═══ One-Click accuracy corpus — SYNTHETIC bucket ═══");
  L.push("  (segs→region→trace core, synthetic inputs; extraction stage (pdf.js) and");
  L.push("   real-plan accuracy are the REAL bucket, #174 — this is not plan accuracy)");
  L.push(`  clean-accept cases : ${cleanAccepts.length}   accept-rate ${(acceptRate * 100).toFixed(0)}%`);
  L.push(`  band (clean)       : mean ${mean.toFixed(3)}  p90 ${p90?.toFixed(3)}  worst ${worst?.toFixed(3)}   (mask px; ~1.0 = clean 1px inset)`);
  L.push(`  refuse cases       : ${refuses.length} (100% still refusing)   known-limitations ${knownLimitations}/${KNOWN_LIMITATION_MAX}`);
  L.push(`  known defects       : ${knownDefects.length} pinned characterizations (excluded from accuracy)`);
  for (const r of knownDefects) L.push(`     • ${r.k}: band ${r.band?.toFixed(2)} — ${r.c.knownDefect}`);
  L.push("═══════════════════════════════════════════════════");
  console.log(L.join("\n"));
});
