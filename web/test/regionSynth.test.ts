// The seeded synthetic set generator (fixtures/regionSynth.ts) — its own
// determinism and self-consistency. It says nothing about detector accuracy.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import type { DetectLine, DetectToken, Edge } from "../src/lib/regionDetect.ts";
import {
  TB_SHEETNO_RE, mulberry32, tokenCenter, toStripUV, DECOY_KINDS, SET_DECOY_KINDS, BOILERPLATE,
  uniformSet24, bottomStripSet5, mixedSet, smallConsultantsSet, singleSheetSet,
  twoSheetSet, noTitleBlockSet, borderlessSet, leftEdgeSet, topEdgeSet, topPartialSet,
  wrongZoneSet, wrongZoneDeepSet, gridDecoySet, gridLegalDecoySet, gridNoTitleBlockSet,
  areaTieBreakSet, frameOnlySet, repeatOnlySet, sparseStripSet, shortBorderSet, missingSideSet,
  randomSet,
  type SynthSet, type SynthSheet, type Truth, type Expect, type Box,
} from "./fixtures/regionSynth.ts";

// [name, build, sheets, family labels, expectGroups, expects]
const NAMED: [string, () => SynthSet, number, number, number | null, Expect[]][] = [
  ["uniformSet24", uniformSet24, 24, 1, 1, ["find"]],
  ["bottomStripSet5", bottomStripSet5, 5, 1, 1, ["find"]],
  ["mixedSet", mixedSet, 6, 3, 3, ["find", "abstain"]],
  ["smallConsultantsSet", smallConsultantsSet, 4, 2, 2, ["find"]],
  ["singleSheetSet", singleSheetSet, 1, 1, 1, ["find"]],
  ["twoSheetSet", twoSheetSet, 2, 1, 1, ["find"]],
  ["noTitleBlockSet", noTitleBlockSet, 3, 1, 3, ["abstain"]],
  ["borderlessSet", borderlessSet, 4, 1, 1, ["find"]],
  ["leftEdgeSet", leftEdgeSet, 5, 1, 1, ["find"]],
  ["topEdgeSet", topEdgeSet, 5, 1, 1, ["find"]],
  ["topPartialSet", topPartialSet, 3, 1, 1, ["find"]],
  ["wrongZoneSet", wrongZoneSet, 3, 1, 1, ["no-rule-A"]],
  ["wrongZoneDeepSet", wrongZoneDeepSet, 1, 1, 1, ["no-rule-A"]],
  ["gridDecoySet", gridDecoySet, 1, 1, 1, ["find"]],
  ["gridLegalDecoySet", gridLegalDecoySet, 1, 1, 1, ["tie-break-area"]],
  ["gridNoTitleBlockSet", gridNoTitleBlockSet, 1, 1, 1, ["abstain"]],
  ["areaTieBreakSet", areaTieBreakSet, 2, 1, 1, ["tie-break-area"]],
  ["frameOnlySet", frameOnlySet, 1, 1, 1, ["abstain"]],
  ["repeatOnlySet", repeatOnlySet, 4, 1, null, ["abstain"]],
  ["sparseStripSet", sparseStripSet, 1, 1, 1, ["abstain"]],
  ["shortBorderSet", shortBorderSet, 3, 1, 1, ["find"]],
  ["missingSideSet", missingSideSet, 3, 1, 1, ["find"]],
];
const BUILDERS: [string, () => SynthSet][] = [...NAMED.map(([n, b]) => [n, b] as [string, () => SynthSet]), ["randomSet", () => randomSet(4242)]];
const build = (name: string) => NAMED.find(([k]) => k === name)![1]();
const allNamed = () => BUILDERS.flatMap(([, b]) => b().sheets);
const allSheets = () => [...allNamed(), ...Array.from({ length: 20 }, (_, i) => randomSet(i + 1).sheets).flat()];

const edgesOf = (s: SynthSet) => s.sheets.map((x) => x.truth?.edge ?? null);
const groupsOf = (s: SynthSet) => s.sheets.map((x) => x.meta.group);
const isH = (l: DetectLine) => l.y0 === l.y1;
const isV = (l: DetectLine) => l.x0 === l.x1;
const ALONG = (e: Edge) => (e === "top" || e === "bottom" ? "x" : "y");
const parallel = (e: Edge, l: DetectLine) => (ALONG(e) === "x" ? isH(l) && !isV(l) : isV(l) && !isH(l));
const near = (a: number, b: number, eps = 1e-6) => Math.abs(a - b) < eps;

/** Tokens whose centers lie in a strip (edge, depth d, along-extent [u0, u1]). */
function stripTokens(sheet: { tokens: DetectToken[] }, s: { edge: Edge; border: Box }, d: number, u0 = 0, u1 = 1) {
  return sheet.tokens.map((t) => ({ t, uv: toStripUV(s, ...tokenCenter(t)) }))
    .filter(({ uv: [u, v] }) => u >= u0 && u <= u1 && v >= 0 && v <= d);
}
const biggestMatch = (xs: ReturnType<typeof stripTokens>) =>
  xs.filter(({ t }) => TB_SHEETNO_RE.test(t.str)).reduce<ReturnType<typeof stripTokens>[0] | null>((a, b) => (!a || b.t.h > a.t.h ? b : a), null);

describe("mulberry32", () => {
  test("same seed → same stream, in [0, 1)", () => {
    const a = mulberry32(7), b = mulberry32(7);
    for (let i = 0; i < 100; i++) {
      const v = a();
      assert.equal(v, b());
      assert.ok(v >= 0 && v < 1);
    }
  });
  test("different seeds diverge", () => assert.notEqual(mulberry32(1)(), mulberry32(2)()));
});

describe("pattern copy", () => {
  test("the fixture's TB_SHEETNO_RE is its own frozen copy", () => {
    assert.equal(TB_SHEETNO_RE.source, "^[A-Z]{1,3}\\d?[-. ]?\\d{1,3}(\\.\\d{1,2})?[A-Z]?$");
    for (const s of ["A-101", "A1-101", "A1.01", "C101", "LVT-1", "B10"]) assert.ok(TB_SHEETNO_RE.test(s), s);
  });
});

describe("determinism", () => {
  for (const [name, b] of BUILDERS) {
    test(`${name}: two builds are deep-equal`, () => assert.deepEqual(b(), b()));
  }
  test("a different seed gives a different set", () => {
    assert.notDeepEqual(uniformSet24(1), uniformSet24(2));
    assert.notDeepEqual(randomSet(1), randomSet(2));
  });
});

describe("documented sets", () => {
  for (const [name, b, n, fams, groups, expects] of NAMED) {
    test(`${name}: ${n} sheets, ${fams} families, groups ${groups}, expect ${expects.join("/")}`, () => {
      const s = b();
      assert.equal(s.sheets.length, n);
      assert.equal(new Set(groupsOf(s)).size, fams);
      assert.equal(s.expectGroups, groups);
      assert.deepEqual([...new Set(s.sheets.map((x) => x.meta.expect))].sort(), [...expects].sort());
      for (const x of s.sheets) {
        if (x.truth) assert.equal(x.truth.family, x.meta.group);
        if (x.meta.expect !== "find") assert.ok(x.meta.why.length > 0, `${x.sheet.key}: expect ${x.meta.expect} needs a why`);
      }
    });
  }

  test("uniform one-firm set of 24: right edge, one template (within ±0.3% jitter)", () => {
    const s = uniformSet24();
    assert.ok(edgesOf(s).every((e) => e === "right"));
    const ds = s.sheets.map((x) => x.truth!.d);
    assert.ok(Math.max(...ds) - Math.min(...ds) <= 0.006 + 1e-9);
    assert.ok(new Set(ds).size > 1, "frame jitter present");
    for (let k = 0; k < 4; k++) {
      const vs = s.sheets.map((x) => x.truth!.border[k] / (k % 2 ? x.sheet.h : x.sheet.w));
      assert.ok(Math.max(...vs) - Math.min(...vs) <= 0.006 + 1e-9);
    }
  });

  test("uniform set carries every non-set decoy kind somewhere", () => {
    const seen = new Set(uniformSet24().sheets.flatMap((x) => x.meta.decoys));
    for (const k of DECOY_KINDS) if (!SET_DECOY_KINDS.includes(k)) assert.ok(seen.has(k), k);
  });

  test("bottom strip set, left, top and top-partial edges", () => {
    assert.ok(edgesOf(bottomStripSet5()).every((e) => e === "bottom"));
    assert.ok(edgesOf(leftEdgeSet()).every((e) => e === "left"));
    assert.ok(edgesOf(topEdgeSet()).every((e) => e === "top"));
    const tp = topPartialSet();
    assert.ok(tp.sheets.every((x) => x.truth!.edge === "top" && x.meta.frame === "partial"));
  });

  test("mixed: 3 + 2 firms + 1 letter sketch", () => {
    const s = mixedSet();
    const g = groupsOf(s);
    assert.deepEqual(g, [g[0], g[0], g[0], g[3], g[3], g[5]]);
    assert.deepEqual(edgesOf(s), ["right", "right", "right", "bottom", "bottom", null]);
    assert.deepEqual(s.sheets[5].sheet.pageIn, [8.5, 11]);
    assert.equal(s.sheets[5].truth, null);
  });

  test("2 + 2 small consultants: same page, edge, border (±0.3%) and d within 1.5%, different statics", () => {
    const s = smallConsultantsSet();
    const g = groupsOf(s);
    assert.equal(g[0], g[1]);
    assert.equal(g[2], g[3]);
    assert.notEqual(g[0], g[2]);
    assert.ok(edgesOf(s).every((e) => e === "bottom"));
    assert.equal(new Set(s.sheets.map((x) => x.sheet.pageIn!.join())).size, 1);
    for (const x of s.sheets) for (let k = 0; k < 4; k++) {
      const dim = k % 2 ? x.sheet.h : x.sheet.w;
      assert.ok(Math.abs(x.truth!.border[k] - s.sheets[0].truth!.border[k]) <= 0.006 * dim + 1e-9);
    }
    for (const a of s.sheets) for (const b of s.sheets) assert.ok(Math.abs(a.truth!.d - b.truth!.d) <= 0.015);
    const [fa, fb] = [s.firms[0], s.firms[1]];
    const shared = fa.statics.filter((t) => fb.statics.includes(t));
    const union = new Set([...fa.statics, ...fb.statics]);
    assert.ok(shared.length / union.size < 0.5, `Jaccard ${shared.length}/${union.size}`);
    const bp = (x: SynthSheet) => {
      const t = x.sheet.tokens.find((k) => k.str === BOILERPLATE)!;
      const [cx, cy] = tokenCenter(t);
      const b = x.meta.border;
      return [(cx - b[0]) / (b[2] - b[0]), (cy - b[1]) / (b[3] - b[1])];
    };
    const [p, q] = [bp(s.sheets[0]), bp(s.sheets[2])];
    assert.ok(Math.abs(p[0] - q[0]) <= 0.02 && Math.abs(p[1] - q[1]) <= 0.02);
  });

  test("borderless: border is the page, no strip rules", () => {
    for (const x of borderlessSet().sheets) {
      assert.deepEqual(x.truth!.border, [0, 0, x.sheet.w, x.sheet.h]);
      assert.equal(x.meta.frame, "none");
      assert.equal(x.truth!.edge, "bottom");
    }
  });

  test("wrong-zone families: the number sits in the near half or at ≥ 70% of the depth", () => {
    const near = wrongZoneSet().sheets, deep = wrongZoneDeepSet().sheets;
    for (const x of [...near, ...deep]) {
      const b = biggestMatch(stripTokens(x.sheet, x.truth!, x.truth!.d))!;
      assert.equal(b.t.str, x.meta.sheetNo);
      const [u, v] = b.uv;
      assert.ok(u < 0.5 || v >= 0.7 * x.truth!.d, `${x.sheet.key}: u ${u} v/d ${v / x.truth!.d}`);
    }
    assert.ok(near.every((x) => { const [u] = biggestMatch(stripTokens(x.sheet, x.truth!, x.truth!.d))!.uv; return u < 0.5; }));
    assert.ok(deep.every((x) => { const [, v] = biggestMatch(stripTokens(x.sheet, x.truth!, x.truth!.d))!.uv; return v >= 0.7 * x.truth!.d; }));
  });

  test("S501 grid: false full-span chains at 20–26% on top/left/right with deep tags", () => {
    const x = gridDecoySet().sheets[0];
    assert.equal(x.truth!.edge, "bottom");
    assert.deepEqual(x.meta.falseStrips.map((f) => f.edge).sort(), ["left", "right", "top"]);
    for (const f of x.meta.falseStrips) {
      assert.ok(f.d >= 0.20 && f.d <= 0.26 && !f.passesA);
      assert.ok(f.u1 - f.u0 >= 0.7 && (near(f.u0, 0) || near(f.u1, 1)));
    }
  });

  test("grid legal variant: one false top chain passes rule A and loses on area", () => {
    const x = gridLegalDecoySet().sheets[0];
    assert.equal(x.meta.falseStrips.length, 1);
    const f = x.meta.falseStrips[0];
    assert.ok(f.edge === "top" && f.passesA && f.d >= 0.20 && f.d <= 0.26);
  });

  test("grid without a title block: false chains on four edges, truth null", () => {
    const x = gridNoTitleBlockSet().sheets[0];
    assert.equal(x.truth, null);
    assert.deepEqual(x.meta.falseStrips.map((f) => f.edge).sort(), ["bottom", "left", "right", "top"]);
    assert.ok(x.meta.falseStrips.every((f) => !f.passesA));
  });

  test("area tie-break: a full-height rule at x≈0.84 crossing a bottom title block", () => {
    for (const x of areaTieBreakSet().sheets) {
      assert.equal(x.truth!.edge, "bottom");
      const f = x.meta.falseStrips[0];
      assert.equal(f.edge, "right");
      assert.ok(f.passesA && 1 - f.d >= 0.83 && 1 - f.d <= 0.85 && near(f.u0, 0) && near(f.u1, 1));
      // the same sheet number is the right strip's biggest match
      assert.equal(biggestMatch(stripTokens(x.sheet, { edge: "right", border: x.meta.border }, f.d))!.t.str, x.meta.sheetNo);
    }
  });

  test("one-signal and sparse negatives", () => {
    const fo = frameOnlySet().sheets[0];
    assert.equal(fo.meta.sheetNo, null);
    assert.equal(fo.meta.frame, "full");
    assert.ok(stripTokens(fo.sheet, fo.truth!, fo.truth!.d).length >= 40, "dense");
    const ro = repeatOnlySet().sheets;
    assert.ok(ro.length >= 3 && ro.every((x) => x.meta.frame === "none" && x.meta.sheetNo === null && !x.meta.borderless));
    const sp = sparseStripSet().sheets[0];
    assert.ok(sp.meta.frame !== "none" && sp.meta.sheetNo !== null);
    assert.ok(stripTokens(sp.sheet, sp.truth!, sp.truth!.d).length < 15);
  });

  test("Porterville-style short border and missing border side", () => {
    for (const x of shortBorderSet().sheets) assert.ok(x.meta.shortBorder && x.truth!.edge === "right");
    for (const x of missingSideSet().sheets) assert.ok(x.meta.borderMissing !== null);
  });

  test("sheet keys follow the sheetKey convention and are unique per set", () => {
    for (const [, b] of BUILDERS) {
      const keys = b().sheets.map((x) => x.sheet.key);
      assert.equal(new Set(keys).size, keys.length);
      for (const k of keys) assert.match(k, /^[\w-]+\.pdf(#\d+)?$/);
    }
  });

  test("statics repeat across a family; fields change", () => {
    for (const [name, b] of BUILDERS) {
      const s = b();
      for (const firm of s.firms) {
        const members = s.sheets.filter((x) => x.meta.group === firm.id);
        assert.ok(firm.statics.length >= 3, `${name} ${firm.id} statics`);
        for (const x of members) {
          const strs = new Set(x.sheet.tokens.map((t) => t.str));
          for (const st of firm.statics) assert.ok(strs.has(st), `${name} ${x.sheet.key}: static ${st}`);
          for (const f of Object.values(x.meta.fields!)) if (f !== null) assert.ok(strs.has(f), `${name} ${x.sheet.key}: field ${f}`);
        }
        if (members.length >= 2) {
          for (const f of ["sheetNo", "title"] as const) {
            const vals = members.map((x) => x.meta.fields![f]).filter((v) => v !== null);
            assert.equal(new Set(vals).size, vals.length, `${name} ${firm.id}: ${f} repeats`);
          }
        }
        if (members.length >= 3) assert.ok(new Set(members.map((x) => x.meta.fields!.date)).size >= 2, `${name} ${firm.id}: date constant`);
      }
    }
  });
});

describe("variety across all sets", () => {
  const sheets = allSheets();
  const found = sheets.filter((x) => x.truth && x.meta.expect === "find" && x.meta.sheetNo);

  test("sheet-number position spans the legal zone", () => {
    const uv = found.map((x) => {
      const [u, v] = biggestMatch(stripTokens(x.sheet, x.truth!, x.truth!.d))!.uv;
      return [u, v / x.truth!.d];
    });
    const us = uv.map((p) => p[0]), vs = uv.map((p) => p[1]);
    assert.ok(Math.min(...us) < 0.6 && Math.max(...us) > 0.9, `u ${Math.min(...us)}–${Math.max(...us)}`);
    assert.ok(Math.min(...vs) < 0.15 && Math.max(...vs) > 0.5, `v/d ${Math.min(...vs)}–${Math.max(...vs)}`);
  });

  test("sheet-number height ratio to the next strip match varies", () => {
    const ratios: number[] = [];
    for (const x of found) {
      const ms = stripTokens(x.sheet, x.truth!, x.truth!.d).filter(({ t }) => TB_SHEETNO_RE.test(t.str)).map(({ t }) => t.h).sort((a, b) => b - a);
      if (ms.length >= 2) ratios.push(ms[0] / ms[1]);
    }
    assert.ok(ratios.length >= 10);
    assert.ok(Math.min(...ratios) < 1.3 && Math.max(...ratios) > 2, `ratios ${Math.min(...ratios)}–${Math.max(...ratios)}`);
  });

  test("strip token counts range 15–170 with some near 15", () => {
    const counts = sheets.filter((x) => x.truth && x.meta.why !== "sparse").map((x) => stripTokens(x.sheet, x.truth!, x.truth!.d).length);
    assert.ok(Math.min(...counts) >= 15 && Math.min(...counts) <= 18, `min ${Math.min(...counts)}`);
    assert.ok(Math.max(...counts) >= 140, `max ${Math.max(...counts)}`);
  });

  test("frames: partial near- and far-anchored, joinable gaps and breaks, jitter", () => {
    const partial = sheets.filter((x) => x.meta.frame === "partial");
    for (const x of partial) assert.ok(x.meta.cover! >= 0.70 && x.meta.cover! <= 0.80, String(x.meta.cover));
    assert.ok(partial.some((x) => x.meta.anchor === "far") && partial.some((x) => x.meta.anchor === "near"));
    const gaps = sheets.flatMap((x) => x.meta.chainGaps);
    assert.ok(gaps.some((g) => g.joins) && gaps.some((g) => !g.joins));
  });

  test("border variants: page-edge rules, missing side, short border, double rules", () => {
    assert.ok(sheets.some((x) => x.meta.pageEdgeRules));
    assert.ok(sheets.some((x) => x.meta.borderMissing));
    assert.ok(sheets.some((x) => x.meta.shortBorder));
    assert.ok(sheets.some((x) => x.meta.decoys.includes("double-rule")));
  });

  test("every decoy kind occurs", () => {
    const seen = new Set(sheets.flatMap((x) => x.meta.decoys));
    for (const k of DECOY_KINDS) assert.ok(seen.has(k), k);
  });

  test("random sets vary edge, d, page and token count", () => {
    const r = Array.from({ length: 20 }, (_, i) => randomSet(i + 1).sheets).flat().filter((x) => x.truth);
    assert.equal(new Set(r.map((x) => x.truth!.edge)).size, 4);
    assert.ok(new Set(r.map((x) => x.truth!.d)).size >= 10);
    assert.ok(new Set(r.map((x) => x.sheet.pageIn!.join())).size >= 3);
    assert.ok(new Set(r.map((x) => x.sheet.tokens.length)).size >= 10);
  });
});

// ── self-consistency of the truth against the generated content ─────────────
function checkDecoys(x: SynthSheet, where: string) {
  const { sheet, truth, meta } = x;
  const [bx0, by0, bx1, by1] = meta.border;
  const BW = bx1 - bx0, BH = by1 - by0;
  const inStrip = (px: number, py: number) => {
    if (!truth) return false;
    const [u, v] = toStripUV(truth, px, py);
    return u >= 0 && u <= 1 && v >= 0 && v <= truth.d;
  };
  const inDrawing = (px: number, py: number) => px > bx0 && px < bx1 && py > by0 && py < by1 && !inStrip(px, py);
  const lineInDrawing = (l: DetectLine) => inDrawing(l.x0, l.y0) && inDrawing(l.x1, l.y1);
  const tables = (minW: number, minRows: number, pred: (l: DetectLine) => boolean) => {
    const byExtent = new Map<string, DetectLine[]>();
    for (const l of sheet.lines) if (isH(l) && l.x1 - l.x0 >= minW && pred(l)) {
      const k = `${l.x0},${l.x1}`;
      byExtent.set(k, [...(byExtent.get(k) ?? []), l]);
    }
    return [...byExtent.values()].filter((ls) => ls.length >= minRows);
  };
  // the legend rule: perpendicular to the edge, 6–30% from a side, from the opposite border inward
  const legend = (tJunction: boolean) => truth && sheet.lines.some((l) => {
    if (!parallel(truth.edge === "top" || truth.edge === "bottom" ? "left" : "top", l)) return false;
    const [ua, va] = toStripUV(truth, l.x0, l.y0), [, vb] = toStripUV(truth, l.x1, l.y1);
    const side = Math.min(ua, 1 - ua), vlo = Math.min(va, vb), vhi = Math.max(va, vb);
    if (!(side >= 0.06 && side <= 0.30 && vhi > 1 - 1e-6 && vhi - vlo >= 0.5)) return false;
    return tJunction ? near(vlo, truth.d) && ua >= meta.chainExtent![0] && ua <= meta.chainExtent![1] : vlo > truth.d + 0.01;
  });
  for (const k of meta.decoys) {
    const w = `${where}: decoy ${k}`;
    switch (k) {
      case "legend-column": assert.ok(legend(false), w); break;
      case "legend-column-t": assert.ok(legend(true), w); break;
      case "schedule-table":
        assert.ok(tables(0.3 * BW, 4, lineInDrawing).length > 0, w);
        break;
      case "wide-table":
        assert.ok(tables(0.6 * BW, 4, lineInDrawing).length > 0, w);
        break;
      case "flush-table": {
        // ≥ 3 rules of one extent, touching a side border, all within 30% of
        // the top or bottom border, the farthest at 6–30%
        const ok = tables(0.7 * BW, 3, (l) => l.y0 !== by0 && l.y0 !== by1).some((ls) => {
          const touches = near(ls[0].x0, bx0) || near(ls[0].x1, bx1);
          const top = ls.map((l) => (l.y0 - by0) / BH), bot = ls.map((l) => (by1 - l.y0) / BH);
          const fits = (ds: number[]) => ds.every((q) => q > 0 && q <= 0.30 + 1e-9) && Math.max(...ds) >= 0.06;
          return touches && (fits(top) || fits(bot));
        });
        assert.ok(ok, w);
        break;
      }
      case "viewport-frame": {
        const ok = sheet.lines.some((top) => isH(top) && lineInDrawing(top) && sheet.lines.some((bot) =>
          isH(bot) && bot.y0 > top.y0 && bot.x0 === top.x0 && bot.x1 === top.x1 &&
          sheet.lines.some((l) => isV(l) && l.x0 === top.x0 && l.y0 === top.y0 && l.y1 === bot.y0) &&
          sheet.lines.some((l) => isV(l) && l.x0 === top.x1 && l.y0 === top.y0 && l.y1 === bot.y0) &&
          sheet.tokens.some((t) => t.str.startsWith("SCALE") && Math.abs(tokenCenter(t)[1] - bot.y0) <= 0.05 * BH)));
        assert.ok(ok, w);
        break;
      }
      case "top-rule-26":
        assert.ok(sheet.lines.some((l) => isH(l) && Math.abs((l.y0 - by0) / BH - 0.26) <= 0.005 && l.x0 <= bx0 + 1 && l.x1 >= bx1 - 1), w);
        break;
      case "sheetno-in-drawing": {
        const ok = sheet.tokens.some((t) => {
          if (!TB_SHEETNO_RE.test(t.str)) return false;
          const [cx, cy] = tokenCenter(t);
          if (!inDrawing(cx, cy)) return false;
          return sheet.lines.some((l) => isH(l)
            ? cx >= l.x0 && cx <= l.x1 && Math.abs(cy - l.y0) <= 0.03 * BH
            : cy >= l.y0 && cy <= l.y1 && Math.abs(cx - l.x0) <= 0.03 * BW);
        });
        assert.ok(ok, w);
        break;
      }
      case "boilerplate": {
        const t = sheet.tokens.find((q) => q.str === BOILERPLATE);
        assert.ok(t, w);
        if (truth) assert.ok(inStrip(...tokenCenter(t)), w);
        break;
      }
      case "double-rule": {
        const ok = sheet.lines.some((a) => sheet.lines.some((b) => a !== b && (isH(a)
          ? isH(b) && Math.abs(b.y0 - a.y0 - 3) < 1e-9 && Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0) >= 0.9 * (a.x1 - a.x0)
          : isV(b) && Math.abs(b.x0 - a.x0 - 3) < 1e-9 && Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0) >= 0.9 * (a.y1 - a.y0))));
        assert.ok(ok, w);
        break;
      }
      case "detail-grid":
      case "crossing-rule":
        assert.ok(meta.falseStrips.length > 0, w);
        break;
      default:
        assert.fail(`${w}: unknown`);
    }
  }
  // false strips: a rule at depth d covering the extent; the sheet-number signal as documented
  for (const f of meta.falseStrips) {
    const w = `${where}: false ${f.edge} ${f.d}`;
    const s = { edge: f.edge, border: meta.border };
    const rule = sheet.lines.some((l) => {
      if (!parallel(f.edge, l)) return false;
      const [ua, va] = toStripUV(s, l.x0, l.y0), [ub] = toStripUV(s, l.x1, l.y1);
      return near(va, f.d) && Math.min(ua, ub) <= f.u0 + 1e-6 && Math.max(ua, ub) >= f.u1 - 1e-6;
    });
    assert.ok(rule, `${w}: rule`);
    const toks = stripTokens(sheet, s, f.d, f.u0, f.u1);
    const b = biggestMatch(toks);
    assert.ok(b, `${w}: no pattern token`);
    const [u, v] = b.uv;
    if (f.passesA) {
      assert.ok(u >= f.u0 + 0.5 * (f.u1 - f.u0) && v <= 0.6 * f.d, `${w}: biggest ${b.t.str} at u ${u} v/d ${v / f.d}`);
      assert.ok(toks.length >= 15, `${w}: ${toks.length} tokens`);
    } else {
      assert.ok(v >= 0.85 * f.d - 1e-9 && v <= 0.95 * f.d + 1e-9, `${w}: biggest ${b.t.str} at v/d ${v / f.d}`);
    }
  }
}

function checkSheet(x: SynthSheet, where: string) {
  const { sheet, truth, meta } = x;
  const [bx0, by0, bx1, by1] = meta.border;
  const W = sheet.w, H = sheet.h;
  for (const t of sheet.tokens) {
    const [cx, cy] = tokenCenter(t);
    assert.ok(cx >= 0 && cx <= W && cy >= 0 && cy <= H, `${where}: token ${t.str} off page`);
    assert.ok(t.str.trim().length > 0 && t.h > 0, `${where}: empty token`);
  }
  for (const l of sheet.lines) {
    assert.ok(l.x0 <= l.x1 && l.y0 <= l.y1, `${where}: line not normalized`);
    assert.ok(isH(l) || isV(l), `${where}: line not axis-aligned`);
    assert.ok(l.x0 >= 0 && l.x1 <= W && l.y0 >= 0 && l.y1 <= H, `${where}: line off page`);
  }
  if (truth) assert.deepEqual(truth.border, meta.border, `${where}: truth border`);
  if (meta.borderless) {
    assert.deepEqual(meta.border, [0, 0, W, H]);
  } else {
    const sides: [Edge, number, number, number][] = [["left", bx0, 0, W], ["top", by0, 0, H], ["right", bx1, W, W], ["bottom", by1, H, H]];
    for (const [side, pos, edge, dim] of sides) {
      const horiz = side === "top" || side === "bottom";
      const onSide = sheet.lines.filter((l) => (horiz ? isH(l) && l.y0 === pos : isV(l) && l.x0 === pos));
      const span = (l: DetectLine) => (horiz ? l.x1 - l.x0 : l.y1 - l.y0) / (horiz ? bx1 - bx0 : by1 - by0);
      if (meta.borderMissing === side) {
        assert.equal(pos, edge, `${where}: missing ${side} not at page edge`);
        assert.equal(onSide.length, 0, `${where}: missing ${side} has a rule`);
        continue;
      }
      const m = Math.abs(pos - edge) / dim;
      assert.ok(m >= 0.01 && m <= 0.07, `${where}: ${side} margin ${m}`);
      const best = Math.max(0, ...onSide.map(span));
      if (meta.shortBorder && horiz) {
        assert.ok(best >= 0.80 - 1e-9 && best <= 0.85 + 1e-9, `${where}: short ${side} border ${best}`);
        const l = onSide.find((q) => near(span(q), best))!;
        assert.ok(near(l.x0, bx0) && truth && near(toStripUV(truth, l.x1, l.y0)[1], truth.d), `${where}: short border ends on the chain`);
      } else if (meta.borderMissing) {
        assert.ok(best >= 0.75, `${where}: ${side} border span ${best}`);
      } else {
        assert.ok(best >= 1 - 1e-6, `${where}: ${side} border span ${best}`);
      }
    }
    for (const l of sheet.lines) {
      const outside = l.x1 < bx0 || l.x0 > bx1 || l.y1 < by0 || l.y0 > by1;
      if (!outside) continue;
      assert.ok(meta.pageEdgeRules, `${where}: line outside border`);
      const nearEdge = isH(l) ? Math.min(l.y0, H - l.y0) <= 0.01 * H : Math.min(l.x0, W - l.x0) <= 0.01 * W;
      assert.ok(nearEdge, `${where}: outside line not at page edge`);
    }
    if (meta.pageEdgeRules) assert.ok(sheet.lines.some((l) => isH(l) && l.y0 < by0 && l.y0 <= 0.01 * H), `${where}: page-edge rule missing`);
  }
  checkDecoys(x, where);
  if (truth === null) {
    assert.equal(meta.sheetNo, null);
    assert.equal(meta.expect, "abstain");
    return;
  }
  const d = truth.d;
  assert.ok(d >= 0.08 && d <= 0.25, `${where}: d ${d}`);
  const bw = bx1 - bx0, bh = by1 - by0;
  const strip = truth.edge === "right" ? [bx1 - d * bw, by0, bx1, by1]
    : truth.edge === "left" ? [bx0, by0, bx0 + d * bw, by1]
    : truth.edge === "bottom" ? [bx0, by1 - d * bh, bx1, by1] : [bx0, by0, bx1, by0 + d * bh];
  assert.ok(strip[0] >= 0 && strip[1] >= 0 && strip[2] <= W && strip[3] <= H && strip[0] < strip[2] && strip[1] < strip[3], `${where}: strip ${strip}`);
  const inStrip = stripTokens(sheet, truth, d);
  if (meta.why === "sparse") assert.ok(inStrip.length < 15 && inStrip.length >= 5, `${where}: sparse ${inStrip.length}`);
  else assert.ok(inStrip.length >= 15, `${where}: ${inStrip.length} strip tokens`);

  // the chain: pieces parallel to the edge at depth d
  const chain = sheet.lines.filter((l) => parallel(truth.edge, l) && near(toStripUV(truth, l.x0, l.y0)[1], d));
  if (meta.frame === "none") {
    assert.equal(chain.length, 0, `${where}: frame none has a chain`);
    assert.equal(meta.chainExtent, null);
  } else {
    assert.ok(chain.length >= 2, `${where}: chain pieces ${chain.length}`);
    const iv = chain.map((l) => {
      const a = toStripUV(truth, l.x0, l.y0)[0], b = toStripUV(truth, l.x1, l.y1)[0];
      return [Math.min(a, b), Math.max(a, b)];
    }).sort((p, q) => p[0] - q[0]);
    const lo = iv[0][0], hi = Math.max(...iv.map((p) => p[1]));
    assert.ok(near(meta.chainExtent![0], lo) && near(meta.chainExtent![1], hi), `${where}: extent`);
    assert.ok(near(hi - lo, meta.cover!), `${where}: chain cover ${hi - lo} vs ${meta.cover}`);
    if (meta.anchor === "far") assert.ok(near(hi, 1) && lo > 0.1);
    else if (meta.anchor === "near") assert.ok(near(lo, 0) && hi < 0.9);
    else assert.ok(near(lo, 0) && near(hi, 1) && meta.frame === "full");
    // uncovered intervals are exactly the documented gaps
    const holes: { u: number; gap: number }[] = [];
    let reach = iv[0][1];
    for (const [a, b] of iv.slice(1)) {
      if (a > reach + 1e-9) holes.push({ u: reach, gap: a - reach });
      reach = Math.max(reach, b);
    }
    assert.equal(holes.length, meta.chainGaps.length, `${where}: holes ${JSON.stringify(holes)}`);
    holes.forEach((h, k) => {
      const g = meta.chainGaps[k];
      assert.ok(near(h.u, g.u) && near(h.gap, g.gap), `${where}: gap ${k}`);
      if (g.joins) assert.ok(g.gap >= 0.002 - 1e-9 && g.gap <= 0.005, `${where}: join gap ${g.gap}`);
      else assert.ok(g.gap >= 0.006 - 1e-9 && g.gap <= 0.008 + 1e-9, `${where}: break gap ${g.gap}`);
    });
    // a break never drops the border-touching run below 70%
    const runs: [number, number][] = [];
    for (const [a, b] of iv) {
      const last = runs[runs.length - 1];
      if (last && a - last[1] <= 0.005 + 1e-9) last[1] = Math.max(last[1], b);
      else runs.push([a, b]);
    }
    assert.ok(runs.some(([a, b]) => (near(a, 0) || near(b, 1)) && b - a >= 0.7), `${where}: no joined run ≥ 70%`);
  }

  // the sheet number
  const b = biggestMatch(inStrip);
  if (meta.sheetNo === null) {
    assert.equal(b, null, `${where}: pattern token in a strip without a sheet number`);
  } else {
    assert.ok(TB_SHEETNO_RE.test(meta.sheetNo), `${where}: sheetNo ${meta.sheetNo}`);
    assert.equal(meta.fields!.sheetNo, meta.sheetNo);
    assert.equal(b!.t.str, meta.sheetNo, `${where}: biggest strip match`);
    assert.equal(inStrip.filter(({ t }) => TB_SHEETNO_RE.test(t.str) && t.h === b!.t.h).length, 1, `${where}: unique biggest`);
    const [u, v] = b!.uv;
    if (meta.expect === "no-rule-A") {
      assert.ok(u < 0.5 || v >= 0.7 * d, `${where}: wrong zone`);
    } else {
      assert.ok(u >= 0.5 && u < 1, `${where}: sheet number u ${u}`);
      assert.ok(v >= 0.05 * d - 1e-9 && v <= 0.6 * d, `${where}: sheet number depth ${v / d}`);
      if (meta.chainExtent) {
        const [lo, hi] = meta.chainExtent;
        assert.ok(u >= lo + 0.5 * (hi - lo) && u <= hi, `${where}: sheet number outside the chain's far half`);
      }
    }
  }
  if (meta.expect === "tie-break-area") {
    const realArea = (meta.chainExtent ? meta.chainExtent[1] - meta.chainExtent[0] : 1) * d;
    const rivals = meta.falseStrips.filter((f) => f.passesA);
    assert.ok(rivals.length > 0, `${where}: no rival`);
    for (const f of rivals) assert.ok(realArea < (f.u1 - f.u0) * f.d, `${where}: real area ${realArea} not smaller`);
  }
}

describe("truth is self-consistent", () => {
  for (const [name, b] of BUILDERS) {
    test(name, () => b().sheets.forEach((x, i) => checkSheet(x, `${name}[${i}] ${x.sheet.key}`)));
  }
  test("random sets across seeds", () => {
    for (let seed = 1; seed <= 20; seed++) randomSet(seed).sheets.forEach((x, i) => checkSheet(x, `randomSet(${seed})[${i}]`));
  });
  test("truth lives outside DetectSheet and has exactly the documented shape", () => {
    for (const x of allNamed()) {
      assert.deepEqual(Object.keys(x.sheet).sort(), ["h", "key", "lines", "pageIn", "source", "tokens", "w"]);
      if (x.truth) assert.deepEqual(Object.keys(x.truth).sort(), ["border", "d", "edge", "family"] satisfies (keyof Truth)[]);
    }
  });
});
