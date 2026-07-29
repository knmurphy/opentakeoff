// Benchmark scorer — the IoU/aggregate math the corpus gate stands on.
import { test } from "node:test";
import assert from "node:assert/strict";
import { polyIoU, ringAreaAbs, scoreGolden, aggregate, crossAgreement, aggregateCross, polyOverlapPx2, caseCoverage, confidenceGate, humanSfGate, seedPairGate, CONF_GATE, CONF_GATE_EXEMPT, type ProbeScore, type CrossScore } from "../bench/score.ts";
import type { Point } from "../src/lib/oneclick.ts";

const sq = (x0: number, y0: number, x1: number, y1: number): Point[] => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];

test("polyIoU: identical squares ≈ 1, disjoint = 0, half-overlap ≈ 1/3", () => {
  assert.ok(polyIoU(sq(0, 0, 100, 100), sq(0, 0, 100, 100)) > 0.97);
  assert.equal(polyIoU(sq(0, 0, 10, 10), sq(50, 50, 60, 60)), 0);
  const half = polyIoU(sq(0, 0, 100, 100), sq(50, 0, 150, 100));   // overlap 50 of union 150
  assert.ok(Math.abs(half - 1 / 3) < 0.03, `≈1/3, got ${half}`);
});

test("scoreGolden: refusal, leak, and clean trace classify correctly", () => {
  const golden = sq(0, 0, 100, 100);
  assert.deepEqual(scoreGolden("leak", null, golden), { iou: 0, leak: false, refused: true });
  const ballooned = scoreGolden("ok", sq(-100, -100, 300, 300), golden);   // 16× the golden
  assert.ok(ballooned.leak && ballooned.iou < 0.5, "a ballooned trace is a leak");
  const clean = scoreGolden("ok", sq(1, 1, 99, 99), golden);
  assert.ok(!clean.leak && !clean.refused && clean.iou > 0.9);
});

test("aggregate: known-fail probes are tracked but never gate", () => {
  const scores: ProbeScore[] = [
    { caseName: "a", probeName: "p1", expect: "golden", status: "ok", iou: 0.98, leak: false, refused: false },
    { caseName: "a", probeName: "p2", expect: "golden", status: "ok", iou: 0.94, leak: false, refused: false },
    { caseName: "b", probeName: "r1", expect: "refusal", status: "leak", correctRefusal: true },
    { caseName: "c", probeName: "kf", expect: "refusal", status: "ok", correctRefusal: false, knownFail: true },
  ];
  const agg = aggregate(scores);
  assert.equal(agg.goldenProbes, 2);
  assert.ok(Math.abs(agg.meanIoU - 0.96) < 1e-9);
  assert.equal(agg.floorIoU, 0.94);
  assert.equal(agg.refusalRate, 0);
  assert.equal(agg.leakRate, 0);
  assert.equal(agg.correctRefusalRate, 1, "the known-fail wrong refusal must not drag the gate");
  assert.equal(agg.knownFails, 1);
});

test("crossAgreement: same verdict everywhere agrees; a flip disagrees; rings score pairwise", () => {
  const ring = sq(0, 0, 100, 100);
  const allTraced = crossAgreement([
    { res: 1, status: "ok", ring },
    { res: 0.5, status: "ok", ring: sq(1, 1, 99, 99) },
  ]);
  assert.ok(allTraced.statusAgree);
  assert.ok((allTraced.minPairIoU ?? 0) > 0.9);

  const allRefused = crossAgreement([
    { res: 1, status: "leak", ring: null },
    { res: 0.5, status: "tiny", ring: null },
  ]);
  assert.ok(allRefused.statusAgree, "leak vs tiny is the same verdict: refused");
  assert.equal(allRefused.minPairIoU, undefined);

  const flip = crossAgreement([
    { res: 1, status: "ok", ring },
    { res: 0.5, status: "tiny", ring: null },
  ]);
  assert.ok(!flip.statusAgree, "traced at one resolution, refused at another = disagreement");
});

test("crossAgreement: divergent rings drive minPairIoU down", () => {
  const three = crossAgreement([
    { res: 1, status: "ok", ring: sq(0, 0, 100, 100) },
    { res: 0.75, status: "ok", ring: sq(0, 0, 100, 100) },
    { res: 0.5, status: "ok", ring: sq(0, 0, 100, 50) },   // half the room lost
  ]);
  assert.ok(three.statusAgree);
  assert.ok((three.minPairIoU ?? 1) < 0.6, `worst pair must reflect the loss, got ${three.minPairIoU}`);
});

test("aggregateCross: known-fail excluded from gating; floor is the worst gating pair", () => {
  const scores: CrossScore[] = [
    { caseName: "a", probeName: "p1", expect: "golden", resolutions: [1, 0.5], statuses: ["ok", "ok"], statusAgree: true, minPairIoU: 0.98 },
    { caseName: "a", probeName: "p2", expect: "golden", resolutions: [1, 0.5], statuses: ["ok", "ok"], statusAgree: true, minPairIoU: 0.92 },
    { caseName: "b", probeName: "r1", expect: "refusal", resolutions: [1, 0.5], statuses: ["leak", "leak"], statusAgree: true },
    { caseName: "c", probeName: "kf", expect: "golden", resolutions: [1, 0.5], statuses: ["ok", "tiny"], statusAgree: false, minPairIoU: 0.10, knownFail: true },
  ];
  const x = aggregateCross(scores);
  assert.equal(x.crossProbes, 3);
  assert.equal(x.disagreements, 0, "the known-fail flip must not gate");
  assert.equal(x.crossFloorIoU, 0.92);
  assert.equal(x.knownFails, 1);
});

// ── SF error + case coverage (round-8 metric additions) ─────────────────────

test("scoreGolden: SF error is the relative area difference", () => {
  const golden: [number, number][] = [[0, 0], [100, 0], [100, 100], [0, 100]];      // 10,000
  const traced: [number, number][] = [[0, 0], [98, 0], [98, 100], [0, 100]];        // 9,800
  const s = scoreGolden("ok", traced, golden);
  assert.ok(Math.abs((s.sfErr ?? 0) - 0.02) < 1e-9, `2% SF error, got ${s.sfErr}`);
});

test("polyOverlapPx2: disjoint rooms cost nothing; a known overlap measures", () => {
  const a: [number, number][] = [[0, 0], [100, 0], [100, 100], [0, 100]];
  const b: [number, number][] = [[200, 0], [300, 0], [300, 100], [200, 100]];
  assert.equal(polyOverlapPx2(a, b), 0, "disjoint");
  const c: [number, number][] = [[80, 0], [180, 0], [180, 100], [80, 100]];         // 20×100 overlap
  const ov = polyOverlapPx2(a, c, 1);
  assert.ok(Math.abs(ov - 2000) / 2000 < 0.05, `≈2000 px², got ${ov}`);
});

test("caseCoverage: totals, ratio, overlap, refused-room penalty, deducts", () => {
  const sq = (x0: number, y0: number, s: number): [number, number][] => [[x0, y0], [x0 + s, y0], [x0 + s, y0 + s], [x0, y0 + s]];
  // two 10×10 ft rooms at 10 px/ft; engine returns one exact, one 2% small
  const cv = caseCoverage("t", [
    { golden: sq(0, 0, 100), ring: sq(0, 0, 100) },
    { golden: sq(200, 0, 100), ring: [[200, 0], [298, 0], [298, 100], [200, 100]] },
  ], 10, true);
  assert.equal(cv.sumGoldenSF, 200);
  assert.ok(Math.abs(cv.sumEngineSF - 198) < 1e-9);
  assert.ok(Math.abs(cv.ratio - 0.99) < 1e-9);
  assert.equal(cv.overlapSF, 0);
  assert.ok(Math.abs(cv.maxSfErr - 0.02) < 1e-9);
  // a refused room counts as 100% error — missing floor can't hide in the mean
  const refused = caseCoverage("t2", [{ golden: sq(0, 0, 100), ring: null }], 10, true);
  assert.equal(refused.maxSfErr, 1);
  assert.equal(refused.sumEngineSF, 0);
  // deducts reduce the golden total (human deducted a column; engine floods around it)
  const ded = caseCoverage("t3", [{ golden: sq(0, 0, 100), ring: sq(0, 0, 100) }], 10, true, 2);
  assert.equal(ded.sumGoldenSF, 98);
});

// ── audit A2: the anti-correlation gate ─────────────────────────────────────
// RFC item D shipped a confidence score anti-correlated with error. These pin
// the gate that keeps it fixed. Note every fixture below carries knownFail on
// the badly-calibrated probes ON PURPOSE: three of the four real offenders are
// flagged that way in the corpus, and `aggregate`/`aggregateCross` both open
// with `filter(s => !s.knownFail)`. A gate routed through either could not fire.

const gp = (probe: string, sfErr: number, confidence: number, knownFail = false): ProbeScore => {
  const [caseName, probeName] = probe.split("/");
  return { caseName, probeName, expect: "golden", status: "ok", iou: 0.9, sfErr, leak: false, refused: false, confidence, knownFail };
};

test("A2 gate: an inaccurate probe may not report high confidence — known-fail included", () => {
  const bad = confidenceGate([gp("acc/a", 0.000, 1.00), gp("acc/b", 0.001, 0.95), gp("wrong/x", 3.842, 0.95, true)]);
  assert.equal(bad.inaccurate.length, 1, "the known-fail probe is IN the population, not filtered out");
  assert.ok(bad.failures.some((f) => /wrong\/x/.test(f) && /anti-correlated/.test(f)), bad.failures.join("; "));
  const good = confidenceGate([gp("acc/a", 0.000, 1.00), gp("acc/b", 0.001, 0.95), gp("wrong/x", 3.842, 0.85, true)]);
  assert.deepEqual(good.failures, []);
});

test("A2 gate: it keys on SF ERROR, not IoU — the 4.3%-at-1.00 probe is caught", () => {
  // two-doorways/center: IoU 0.957 (invisible to any IoU threshold) but 4.33%
  // SF off — the number a bid is actually written from.
  const s = [gp("acc/a", 0.000, 1.00), gp("acc/b", 0.002, 0.95), gp("two-doorways/center", 0.0433, 1.00)];
  s[2].iou = 0.957;
  assert.ok(confidenceGate(s).failures.some((f) => /two-doorways/.test(f)));
});

test("A2 gate: a refusal probe that TRACES fails the ceiling whatever its confidence", () => {
  const refusalTraced = (conf?: number): ProbeScore =>
    ({ caseName: "va-finish-plan", probeName: "open-margin", expect: "refusal", status: "ok", correctRefusal: false, confidence: conf, knownFail: true });
  const base = [gp("acc/a", 0.000, 1.00), gp("acc/b", 0.001, 0.95)];
  assert.ok(confidenceGate([...base, refusalTraced(0.97)]).failures.some((f) => /open-margin/.test(f) && /refuse/.test(f)));
  // ...and reporting NO confidence is itself a failure: that is precisely how
  // open-margin sat outside the gate before A2.
  assert.ok(confidenceGate([...base, refusalTraced(undefined)]).failures.some((f) => /open-margin/.test(f) && /NO confidence/.test(f)));
  assert.deepEqual(confidenceGate([...base, refusalTraced(0.65)]).failures, []);
  // a refusal probe that correctly refuses is not in any population
  assert.deepEqual(confidenceGate([...base, { caseName: "c", probeName: "r", expect: "refusal", status: "leak", correctRefusal: true }]).failures, []);
});

test("A2 gate: the floor is RELATIVE with a margin — a constant-score stub cannot pass it", () => {
  // "replacing traceConfidence with () => ({score: 0.5, factors: []})" — the
  // stated anti-gaming case. It satisfies every ceiling and any non-strict
  // floor; the margin is what refuses it.
  const stub = [gp("acc/a", 0.000, 0.5), gp("acc/b", 0.001, 0.5), gp("wrong/x", 3.842, 0.5, true), gp("wrong/y", 0.974, 0.5, true)];
  const r = confidenceGate(stub);
  assert.deepEqual(r.inaccurate.map((p) => p.confidence), [0.5, 0.5]);
  assert.ok(r.failures.length >= 2, `a constant score must FAIL the floor: ${JSON.stringify(r.failures)}`);
  assert.ok(r.failures.every((f) => /median-of-inaccurate|absolute floor/.test(f)));
});

test("A2 gate: an accurate probe below the inaccurate median + margin fails", () => {
  const s = [gp("acc/low", 0.000, 0.86), gp("acc/hi", 0.001, 0.99), gp("wrong/x", 3.842, 0.85, true)];
  assert.ok(confidenceGate(s).failures.some((f) => /acc\/low/.test(f) && /median-of-inaccurate/.test(f)));
  const ok = [gp("acc/low", 0.000, 0.89), gp("acc/hi", 0.001, 0.99), gp("wrong/x", 3.842, 0.85, true)];
  assert.deepEqual(confidenceGate(ok).failures, []);
});

test("A2 gate: empty populations do something, not nothing", () => {
  // no accurate probe at all ⇒ the gate is NOT satisfied. Otherwise deleting
  // the accurate probes would silently disable the floor.
  const noAcc = confidenceGate([gp("wrong/x", 3.842, 0.85, true)]);
  assert.ok(noAcc.failures.some((f) => /the floor cannot be evaluated/.test(f)), noAcc.failures.join("; "));
  // no inaccurate probe ⇒ no median to compare to, so the CALIBRATED ABSOLUTE
  // floor applies instead — the check is not skipped.
  assert.deepEqual(confidenceGate([gp("acc/a", 0.000, 0.99)]).failures, []);
  const low = confidenceGate([gp("acc/a", 0.000, CONF_GATE.floorAbs - 0.01)]);
  assert.ok(low.failures.some((f) => /ABSOLUTE floor/.test(f)), low.failures.join("; "));
  // probes in the dead zone between the two thresholds join neither population
  const dead = confidenceGate([gp("acc/a", 0.000, 0.99), gp("mid/m", 0.02, 0.10)]);
  assert.deepEqual(dead.inaccurate, []);
  assert.equal(dead.accurate.length, 1);
});

test("A2 gate: the exemption list is BOUNDED, reasoned, and xfailed WITH A DIRECTION", () => {
  // (b) the bound — an exemption list that can grow is `knownFail` again.
  // A5b took it from 1 to 3: measuring the product's SNAPPED ring moved the
  // nine synthetic probes out of the gate's dead zone and into the accurate
  // population for the first time, where two of them fail the floor for
  // reasons that are findings, not miscalibrations. See CONF_GATE_EXEMPT.
  assert.deepEqual(Object.keys(CONF_GATE_EXEMPT).sort(),
    ["annotation-ring-room/center", "corridor-open-ends/mid-corridor", "tile-grid-room/in-cell", "two-doorways/center"],
    "adding another needs its own argument, not a bigger list");
  // (c) EVERY entry records the signal set it was evaluated against — not just
  // "known limit" — and (a) EVERY entry carries at least one xfail DIRECTION,
  // so the day the situation improves the gate fails instead of absorbing it.
  for (const [probe, e] of Object.entries(CONF_GATE_EXEMPT)) {
    for (const signal of ["raster", "hatchFiltered", "wedges", "wedgeGrowth", "curveFrac", "minPassDelta", "areaSF", "mppf"])
      assert.match(e.reason, new RegExp(signal), `${probe}: the exemption must name ${signal} among the signals it was evaluated against`);
    assert.match(e.reason, /XFAIL DIRECTION/, `${probe}: the reason must state its xfail direction in prose too`);
    assert.ok(e.xfailAbove != null || e.xfailAtMost != null || e.xfailEquals != null,
      `${probe}: an exemption with no direction is \`knownFail\` under a new name`);
  }
  const { reason, xfailAbove } = CONF_GATE_EXEMPT["annotation-ring-room/center"];
  for (const signal of ["sealedPx", "virtualFrac"]) assert.match(reason, new RegExp(signal));
  assert.equal(xfailAbove, 0.90);
  // the two A5b entries assert in the OTHER direction: they say a deduction
  // that cannot yet discriminate still cannot.
  assert.equal(CONF_GATE_EXEMPT["two-doorways/center"].xfailAtMost, 0.87);
  assert.ok(CONF_GATE_EXEMPT["two-doorways/center"].xfailAtMost! < CONF_GATE.floorAbs,
    "the ceiling it is held under must sit BELOW the floor it is excused from, or the exemption excuses nothing");
  assert.equal(CONF_GATE_EXEMPT["tile-grid-room/in-cell"].xfailEquals, "partition-bank-15in/mid-bay");
  const exempt = (conf?: number): ProbeScore =>
    ({ caseName: "annotation-ring-room", probeName: "center", expect: "golden", status: "ok", iou: 0.65, sfErr: 0.35, leak: false, refused: false, confidence: conf, knownFail: true });
  const base = [gp("acc/a", 0.000, 1.00), gp("acc/b", 0.001, 0.95), gp("wrong/x", 3.842, 0.85, true)];
  assert.deepEqual(confidenceGate([...base, exempt(1.00)]).failures, [], "today it scores 1.00 and is exempt");
  const flipped = confidenceGate([...base, exempt(0.88)]);
  assert.ok(flipped.failures.some((f) => /XFAIL FLIPPED/.test(f)), flipped.failures.join("; "));
  assert.ok(confidenceGate([...base, exempt(undefined)]).failures.some((f) => /no confidence at all/.test(f)));
  // exempt probes are in neither gating population
  assert.equal(confidenceGate([...base, exempt(1.00)]).inaccurate.length, 1);
});

test("A2/A5b gate: the xfailAtMost and xfailEquals directions flip the same way round", () => {
  const base = [gp("acc/a", 0.000, 1.00), gp("acc/b", 0.001, 0.95), gp("wrong/x", 3.842, 0.85, true)];
  // xfailAtMost — two-doorways/center. Today 0.85 ≤ 0.87 and it is excused;
  // the day the engine can justify withholding the deduction it rises and this
  // fires instead of quietly absorbing the improvement.
  const twoDoor = (conf: number): ProbeScore =>
    ({ caseName: "two-doorways", probeName: "center", expect: "golden", status: "ok", iou: 1, sfErr: 0, leak: false, refused: false, confidence: conf });
  assert.deepEqual(confidenceGate([...base, twoDoor(0.85)]).failures, []);
  assert.ok(confidenceGate([...base, twoDoor(0.92)]).failures.some((f) => /two-doorways/.test(f) && /XFAIL FLIPPED/.test(f)));

  // xfailEquals — tile-grid-room/in-cell is excused only for as long as its
  // score is IDENTICAL to partition-bank-15in/mid-bay's, which is the finding.
  const tile = (conf: number): ProbeScore =>
    ({ caseName: "tile-grid-room", probeName: "in-cell", expect: "golden", status: "ok", iou: 1, sfErr: 0, leak: false, refused: false, confidence: conf });
  const bank = (conf: number): ProbeScore =>
    ({ caseName: "partition-bank-15in", probeName: "mid-bay", expect: "golden", status: "ok", iou: 0.2, sfErr: 4.0, leak: true, refused: false, confidence: conf, knownFail: true });
  assert.deepEqual(confidenceGate([...base, tile(0.85), bank(0.85)]).failures, []);
  const split = confidenceGate([...base, tile(0.95), bank(0.85)]);
  assert.ok(split.failures.some((f) => /tile-grid-room/.test(f) && /no longer equals/.test(f)), split.failures.join("; "));
  // …and if the probe it is compared against leaves the corpus, the assertion
  // is UNCHECKABLE, which is a failure rather than a silent pass
  const orphan = confidenceGate([...base, tile(0.85)]);
  assert.ok(orphan.failures.some((f) => /XFAIL UNCHECKABLE/.test(f)), orphan.failures.join("; "));
});

test("aggregate: per-class filtering isolates a failing class from a passing one", () => {
  const mkc = (shapeClass: string, iou: number, knownFail = false): ProbeScore =>
    ({ caseName: "c", probeName: shapeClass + iou, expect: "golden", status: "ok", iou, sfErr: 0, shapeClass, knownFail } as ProbeScore);
  const scores = [mkc("room", 1.0), mkc("room", 0.98), mkc("corridor", 0.33, true)];
  const room = aggregate(scores.filter((s) => s.shapeClass === "room"));
  const corridor = aggregate(scores.filter((s) => s.shapeClass === "corridor"));
  assert.equal(room.goldenProbes, 2);
  assert.ok(room.floorIoU > 0.9);
  // known-fail-only class: no gating probes, no fabricated accuracy claim
  assert.equal(corridor.goldenProbes, 0);
  assert.equal(corridor.knownFails, 1);
});

// ── scorer mutation tests: the scorer itself under independent arithmetic ────
// polyIoU and ringAreaAbs grade every corpus number; nothing above checks THEM
// against math they didn't compute. Analytic references are coded inline and
// independently (rect intersection, shoelace), so a scorer bug cannot certify
// itself.

test("mutation: polyIoU matches analytic rect IoU exactly on integer-aligned cases", () => {
  // cell centers sit at *.5 — strictly interior to integer-aligned edges — so
  // rasterized IoU is EXACT here; any drift is a scorer change, not noise.
  const analytic = (a: [number, number, number, number], b: [number, number, number, number]): number => {
    const ix = Math.max(0, Math.min(a[2], b[2]) - Math.max(a[0], b[0]));
    const iy = Math.max(0, Math.min(a[3], b[3]) - Math.max(a[1], b[1]));
    const inter = ix * iy;
    const union = (a[2] - a[0]) * (a[3] - a[1]) + (b[2] - b[0]) * (b[3] - b[1]) - inter;
    return union > 0 ? inter / union : 0;
  };
  const r = (x0: number, y0: number, x1: number, y1: number): Point[] => sq(x0, y0, x1, y1);
  // identical / containment / half-overlap / disjoint
  assert.equal(polyIoU(r(0, 0, 100, 100), r(0, 0, 100, 100)), 1);
  assert.equal(polyIoU(r(0, 0, 100, 100), r(0, 0, 50, 50)), analytic([0, 0, 100, 100], [0, 0, 50, 50]));      // 0.25
  assert.equal(polyIoU(r(0, 0, 100, 100), r(50, 0, 150, 100)), analytic([0, 0, 100, 100], [50, 0, 150, 100])); // 1/3
  assert.equal(polyIoU(r(0, 0, 100, 100), r(200, 0, 300, 100)), 0);
});

test("mutation: ringAreaAbs agrees with an independently coded shoelace", () => {
  const shoelace = (p: Point[]): number => {
    let s = 0;
    for (let i = 0; i < p.length; i++) { const q = p[(i + 1) % p.length]; s += p[i][0] * q[1] - q[0] * p[i][1]; }
    return Math.abs(s) / 2;
  };
  const rect = sq(0, 0, 100, 50);
  const ell: Point[] = [[0, 0], [4, 0], [4, 2], [2, 2], [2, 4], [0, 4]];   // concave L, area 12
  assert.equal(ringAreaAbs(rect), shoelace(rect));
  assert.equal(ringAreaAbs(rect), 5000);
  assert.equal(ringAreaAbs(ell), shoelace(ell));
  assert.equal(ringAreaAbs(ell), 12);
});

test("mutation: perturbing one golden vertex moves polyIoU by the analytic amount", () => {
  // square (0,0)-(100,100) vs the quad with corner (100,100) pulled to
  // (100+d,100+d): the quad contains the square, so IoU = 10^4 / area(quad),
  // area(quad) = 10000 + 100d by shoelace. d=1 → 0.9901, d=5 → 0.9524.
  const golden = sq(0, 0, 100, 100);
  const mutated = (d: number): Point[] => [[0, 0], [100, 0], [100 + d, 100 + d], [0, 100]];
  const analytic = (d: number): number => 10000 / (10000 + 100 * d);
  const at1 = polyIoU(golden, mutated(1));
  const at5 = polyIoU(golden, mutated(5));
  // d=1 held to ±0.005: a scorer stuck at ~1.0 (union≡intersection, the
  // canonical mutation) misses the analytic 0.9901 by 0.0099 and FAILS here.
  assert.ok(Math.abs(at1 - analytic(1)) <= 0.005, `d=1: ${at1} vs analytic ${analytic(1)}`);
  assert.ok(Math.abs(at5 - analytic(5)) <= 0.01, `d=5: ${at5} vs analytic ${analytic(5)}`);
  assert.ok(polyIoU(golden, mutated(0)) > at1 && at1 > at5, "IoU must fall monotonically as the vertex moves");
});

// ── human-SF reference rows + seed-pair stability gates ─────────────────────

test("humanSfGate: fires past the band, stays quiet inside it, and xpasses loudly", () => {
  const band = 0.025;
  // non-knownFail: 3% off fires, 2% off passes, a refused trace fires
  assert.ok(humanSfGate([{ probe: "p/a", handSF: 100, engineSF: 103 }], band).failures.some((f) => /3\.0% off hand/.test(f)));
  assert.deepEqual(humanSfGate([{ probe: "p/a", handSF: 100, engineSF: 102 }], band).failures, []);
  assert.ok(humanSfGate([{ probe: "p/a", handSF: 100, engineSF: null }], band).failures.some((f) => /no trace/.test(f)));
  // knownFail: outside the band is the documented state (silent); INSIDE it is
  // an xpass that demands re-examination, and a missing trace stays silent
  assert.deepEqual(humanSfGate([{ probe: "p/kf", handSF: 100, engineSF: 110, knownFail: true }], band).failures, []);
  assert.ok(humanSfGate([{ probe: "p/kf", handSF: 100, engineSF: 101, knownFail: true }], band).failures.some((f) => /now within/.test(f)));
  assert.deepEqual(humanSfGate([{ probe: "p/kf", handSF: 100, engineSF: null, knownFail: true }], band).failures, []);
});

test("seedPairGate: symmetric ratio, xpass on convergence to ANY common region", () => {
  // knownFail split 9.65× (the VA T1 corridor): documented state, no failure
  assert.deepEqual(seedPairGate([{ pair: "c/p", sfA: 158.1, sfB: 1525.8, knownFail: true, xpassRatio: 1.5 }]).failures, []);
  // knownFail converged — whichever region won, this must fire for re-examination
  const conv = seedPairGate([{ pair: "c/p", sfA: 1500, sfB: 1525.8, knownFail: true, xpassRatio: 1.5 }]);
  assert.ok(conv.failures.some((f) => /now agrees/.test(f)), conv.failures.join("; "));
  // symmetric: swapping the seeds changes nothing
  assert.equal(seedPairGate([{ pair: "c/p", sfA: 1525.8, sfB: 158.1, knownFail: true, xpassRatio: 1.5 }]).rows[0].ratio,
    seedPairGate([{ pair: "c/p", sfA: 158.1, sfB: 1525.8, knownFail: true, xpassRatio: 1.5 }]).rows[0].ratio);
  // non-knownFail: agreement passes, disagreement or a refused seed fails
  assert.deepEqual(seedPairGate([{ pair: "c/q", sfA: 100, sfB: 120, xpassRatio: 1.5 }]).failures, []);
  assert.ok(seedPairGate([{ pair: "c/q", sfA: 100, sfB: 200, xpassRatio: 1.5 }]).failures.some((f) => /disagree/.test(f)));
  assert.ok(seedPairGate([{ pair: "c/q", sfA: null, sfB: 200, xpassRatio: 1.5 }]).failures.some((f) => /failed to trace/.test(f)));
  // a knownFail pair with a refused seed: still disagreeing at the verdict
  // level — not an xpass, not a failure
  assert.deepEqual(seedPairGate([{ pair: "c/p", sfA: null, sfB: 200, knownFail: true, xpassRatio: 1.5 }]).failures, []);
});
