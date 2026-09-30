// The seeded synthetic set generator (fixtures/regionSynth.ts) — its own
// determinism and self-consistency. It says nothing about detector accuracy.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { TB_SHEETNO_RE, type DetectLine } from "../src/lib/regionDetect.ts";
import {
  mulberry32, tokenCenter, toStripUV, DECOY_KINDS, BOILERPLATE,
  uniformSet24, bottomStripSet5, mixedSet, smallConsultantsSet, singleSheetSet,
  twoSheetSet, noTitleBlockSet, borderlessSet, leftEdgeSet, topEdgeSet, randomSet,
  type SynthSet, type SynthSheet, type Truth,
} from "./fixtures/regionSynth.ts";

const NAMED: [string, () => SynthSet][] = [
  ["uniformSet24", uniformSet24], ["bottomStripSet5", bottomStripSet5], ["mixedSet", mixedSet],
  ["smallConsultantsSet", smallConsultantsSet], ["singleSheetSet", singleSheetSet],
  ["twoSheetSet", twoSheetSet], ["noTitleBlockSet", noTitleBlockSet], ["borderlessSet", borderlessSet],
  ["leftEdgeSet", leftEdgeSet], ["topEdgeSet", topEdgeSet], ["randomSet", () => randomSet(4242)],
];

const edgesOf = (s: SynthSet) => s.sheets.map((x) => x.truth?.edge ?? null);
const groupsOf = (s: SynthSet) => s.sheets.map((x) => x.meta.group);

describe("mulberry32", () => {
  test("same seed → same stream, in [0, 1)", () => {
    const a = mulberry32(7), b = mulberry32(7);
    for (let i = 0; i < 100; i++) {
      const v = a();
      assert.equal(v, b());
      assert.ok(v >= 0 && v < 1);
    }
  });
  test("different seeds diverge", () => {
    assert.notEqual(mulberry32(1)(), mulberry32(2)());
  });
});

describe("determinism", () => {
  for (const [name, build] of NAMED) {
    test(`${name}: two builds are deep-equal`, () => assert.deepEqual(build(), build()));
  }
  test("a different seed gives a different set", () => {
    assert.notDeepEqual(uniformSet24(1), uniformSet24(2));
    assert.notDeepEqual(randomSet(1), randomSet(2));
  });
});

describe("documented sets", () => {
  // [set, sheets, distinct family labels, expected detector groups]
  const COUNTS: [string, number, number, number][] = [
    ["uniformSet24", 24, 1, 1], ["bottomStripSet5", 5, 1, 1], ["mixedSet", 6, 3, 3],
    ["smallConsultantsSet", 4, 2, 2], ["singleSheetSet", 1, 1, 1], ["twoSheetSet", 2, 1, 1],
    ["noTitleBlockSet", 3, 1, 3], ["borderlessSet", 4, 1, 1], ["leftEdgeSet", 5, 1, 1], ["topEdgeSet", 5, 1, 1],
  ];
  for (const [name, n, fams, groups] of COUNTS) {
    test(`${name}: ${n} sheets, ${fams} families, ${groups} groups`, () => {
      const s = NAMED.find(([k]) => k === name)![1]();
      assert.equal(s.sheets.length, n);
      assert.equal(new Set(groupsOf(s)).size, fams);
      assert.equal(s.expectGroups, groups);
      for (const x of s.sheets) if (x.truth) assert.equal(x.truth.family, x.meta.group);
    });
  }

  test("uniform one-firm set of 24: right edge, one template", () => {
    const s = uniformSet24();
    assert.ok(edgesOf(s).every((e) => e === "right"));
    assert.equal(new Set(s.sheets.map((x) => x.truth!.d)).size, 1);
    assert.equal(new Set(s.sheets.map((x) => x.truth!.border.join())).size, 1);
  });

  test("uniform set carries every decoy kind somewhere", () => {
    const seen = new Set(uniformSet24().sheets.flatMap((x) => x.meta.decoys));
    for (const k of DECOY_KINDS) assert.ok(seen.has(k), k);
  });

  test("one firm, bottom strip", () => {
    assert.ok(edgesOf(bottomStripSet5()).every((e) => e === "bottom"));
  });

  test("mixed: 3 + 2 firms + 1 letter sketch", () => {
    const s = mixedSet();
    const g = groupsOf(s);
    assert.deepEqual(g, [g[0], g[0], g[0], g[3], g[3], g[5]]);
    assert.equal(new Set(g).size, 3);
    assert.deepEqual(edgesOf(s), ["right", "right", "right", "bottom", "bottom", null]);
    const sketch = s.sheets[5];
    assert.deepEqual(sketch.sheet.pageIn, [8.5, 11]);
    assert.equal(sketch.truth, null);
    assert.equal(sketch.meta.sheetNo, null);
  });

  test("2 + 2 small consultants: same page, edge, border and d within 1.5%, different statics", () => {
    const s = smallConsultantsSet();
    const g = groupsOf(s);
    assert.equal(g[0], g[1]);
    assert.equal(g[2], g[3]);
    assert.notEqual(g[0], g[2]);
    assert.ok(edgesOf(s).every((e) => e === "bottom"));
    assert.equal(new Set(s.sheets.map((x) => x.sheet.pageIn!.join())).size, 1);
    assert.equal(new Set(s.sheets.map((x) => x.truth!.border.join())).size, 1);
    assert.ok(Math.abs(s.sheets[0].truth!.d - s.sheets[2].truth!.d) <= 0.015);
    const [fa, fb] = [s.firms[0], s.firms[1]];
    const shared = fa.statics.filter((t) => fb.statics.includes(t));
    const union = new Set([...fa.statics, ...fb.statics]);
    assert.ok(shared.length / union.size < 0.5, `Jaccard ${shared.length}/${union.size}`);
    // different bottom blocks: the cell dividers differ
    const dividers = (x: SynthSheet) => x.sheet.lines.filter((l) => l.x0 === l.x1 && l.y1 === x.truth!.border[3]).map((l) => l.x0).sort().join();
    assert.notEqual(dividers(s.sheets[0]), dividers(s.sheets[2]));
    // agency boilerplate is shared, at the same border-normalized spot
    const bp = (x: SynthSheet) => {
      const t = x.sheet.tokens.find((k) => k.str === BOILERPLATE)!;
      const [cx, cy] = tokenCenter(t);
      const b = x.meta.border;
      return [(cx - b[0]) / (b[2] - b[0]), (cy - b[1]) / (b[3] - b[1])];
    };
    const [p, q] = [bp(s.sheets[0]), bp(s.sheets[2])];
    assert.ok(Math.abs(p[0] - q[0]) <= 0.02 && Math.abs(p[1] - q[1]) <= 0.02);
  });

  test("single sheet and 2-sheet sets have a title block", () => {
    assert.ok(singleSheetSet().sheets.every((x) => x.truth !== null));
    assert.ok(twoSheetSet().sheets.every((x) => x.truth !== null));
  });

  test("no title block: bordered sheets, truth null", () => {
    for (const x of noTitleBlockSet().sheets) {
      assert.equal(x.truth, null);
      assert.equal(x.meta.sheetNo, null);
      assert.equal(x.meta.frame, "none");
      assert.equal(x.meta.borderless, false);
    }
  });

  test("borderless: border is the page, no strip rules", () => {
    for (const x of borderlessSet().sheets) {
      assert.deepEqual(x.truth!.border, [0, 0, x.sheet.w, x.sheet.h]);
      assert.equal(x.meta.frame, "none");
      assert.equal(x.truth!.edge, "bottom");
    }
  });

  test("left and top edge variants", () => {
    assert.ok(edgesOf(leftEdgeSet()).every((e) => e === "left"));
    assert.ok(edgesOf(topEdgeSet()).every((e) => e === "top"));
  });

  test("random sets vary edge, d, border and page", () => {
    const all = Array.from({ length: 20 }, (_, i) => randomSet(i + 1).sheets).flat().filter((x) => x.truth);
    assert.equal(new Set(all.map((x) => x.truth!.edge)).size, 4);
    assert.ok(new Set(all.map((x) => x.truth!.d)).size >= 10);
    assert.ok(new Set(all.map((x) => x.sheet.pageIn!.join())).size >= 3);
    assert.ok(new Set(all.map((x) => x.sheet.tokens.length)).size >= 10);
  });

  test("partial frames occur, covering 70–80%", () => {
    const all = [...NAMED.flatMap(([, b]) => b().sheets), ...randomSet(1).sheets, ...randomSet(2).sheets];
    const partial = all.filter((x) => x.meta.frame === "partial");
    assert.ok(partial.length > 0);
    for (const x of partial) assert.ok(x.meta.cover! >= 0.70 && x.meta.cover! <= 0.80, String(x.meta.cover));
  });

  test("page-edge rules outside the border occur", () => {
    const all = NAMED.flatMap(([, b]) => b().sheets);
    assert.ok(all.some((x) => x.meta.pageEdgeRules));
  });

  test("sheet keys follow the sheetKey convention and are unique per set", () => {
    for (const [, build] of NAMED) {
      const keys = build().sheets.map((x) => x.sheet.key);
      assert.equal(new Set(keys).size, keys.length);
      for (const k of keys) assert.match(k, /^[\w-]+\.pdf(#\d+)?$/);
    }
  });

  test("statics repeat across a family; fields change", () => {
    for (const [name, build] of NAMED) {
      const s = build();
      for (const firm of s.firms) {
        const members = s.sheets.filter((x) => x.meta.group === firm.id);
        assert.ok(firm.statics.length >= 3, `${name} ${firm.id} statics`);
        for (const x of members) {
          const strs = new Set(x.sheet.tokens.map((t) => t.str));
          for (const st of firm.statics) assert.ok(strs.has(st), `${name} ${x.sheet.key}: static ${st}`);
          for (const f of Object.values(x.meta.fields!)) assert.ok(strs.has(f), `${name} ${x.sheet.key}: field ${f}`);
        }
        if (members.length >= 2) {
          for (const f of ["sheetNo", "title"] as const) {
            const vals = members.map((x) => x.meta.fields![f]);
            assert.equal(new Set(vals).size, vals.length, `${name} ${firm.id}: ${f} repeats`);
          }
        }
        if (members.length >= 3) assert.ok(new Set(members.map((x) => x.meta.fields!.date)).size >= 2, `${name} ${firm.id}: date constant`);
      }
    }
  });
});

// ── self-consistency of the truth against the generated content ─────────────
const ALONG = (e: string) => (e === "top" || e === "bottom" ? "x" : "y");
const isH = (l: DetectLine) => l.y0 === l.y1;
const isV = (l: DetectLine) => l.x0 === l.x1;

/** Evidence in the content for each decoy kind the meta claims. */
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
  for (const k of meta.decoys) {
    const w = `${where}: decoy ${k}`;
    switch (k) {
      case "legend-column": {
        // perpendicular to the title-block edge, 6–30% from an adjacent border
        // side, long, ending short of the title-block chain
        assert.ok(truth, w);
        const ok = sheet.lines.some((l) => {
          if (ALONG(truth.edge) === "x" ? !isV(l) : !isH(l)) return false;
          const [ua, va] = toStripUV(truth, l.x0, l.y0), [, vb] = toStripUV(truth, l.x1, l.y1);
          const side = Math.min(ua, 1 - ua);
          const vlo = Math.min(va, vb), vhi = Math.max(va, vb);
          return side >= 0.06 && side <= 0.30 && vhi > 1 - 1e-6 && vlo > truth.d + 0.01 && vhi - vlo >= 0.5;
        });
        assert.ok(ok, w);
        break;
      }
      case "schedule-table": {
        const hs = sheet.lines.filter((l) => isH(l) && lineInDrawing(l) && l.x1 - l.x0 >= 0.3 * BW);
        const byExtent = new Map<string, number>();
        for (const l of hs) byExtent.set(`${l.x0},${l.x1}`, (byExtent.get(`${l.x0},${l.x1}`) ?? 0) + 1);
        assert.ok([...byExtent.values()].some((n) => n >= 4), w);
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
      default:
        assert.fail(`${w}: unknown`);
    }
  }
}

function checkSheet(x: SynthSheet, where: string) {
  const { sheet, truth, meta } = x;
  const [bx0, by0, bx1, by1] = meta.border;
  const W = sheet.w, H = sheet.h;
  const eps = 0.5;
  // everything on the page
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
  // border 1–7% per side (borderless: the page itself)
  if (meta.borderless) {
    assert.deepEqual(meta.border, [0, 0, W, H]);
  } else {
    for (const m of [bx0 / W, by0 / H, (W - bx1) / W, (H - by1) / H]) {
      assert.ok(m >= 0.01 && m <= 0.07, `${where}: border margin ${m}`);
    }
    const has = (p: (l: DetectLine) => boolean) => sheet.lines.some(p);
    assert.ok(has((l) => l.y0 === by0 && l.y1 === by0 && l.x0 <= bx0 + eps && l.x1 >= bx1 - eps), `${where}: top border`);
    assert.ok(has((l) => l.y0 === by1 && l.y1 === by1 && l.x0 <= bx0 + eps && l.x1 >= bx1 - eps), `${where}: bottom border`);
    assert.ok(has((l) => l.x0 === bx0 && l.x1 === bx0 && l.y0 <= by0 + eps && l.y1 >= by1 - eps), `${where}: left border`);
    assert.ok(has((l) => l.x0 === bx1 && l.x1 === bx1 && l.y0 <= by0 + eps && l.y1 >= by1 - eps), `${where}: right border`);
    // nothing but page-edge rules lies outside the border
    for (const l of sheet.lines) {
      const outside = l.x1 < bx0 || l.x0 > bx1 || l.y1 < by0 || l.y0 > by1;
      if (!outside) continue;
      assert.ok(meta.pageEdgeRules, `${where}: line outside border`);
      const nearEdge = isH(l) ? Math.min(l.y0, H - l.y0) <= 0.01 * H : Math.min(l.x0, W - l.x0) <= 0.01 * W;
      assert.ok(nearEdge, `${where}: outside line not at page edge`);
    }
    if (meta.pageEdgeRules) {
      assert.ok(sheet.lines.some((l) => isH(l) ? l.y0 < by0 && l.y0 <= 0.01 * H : false), `${where}: page-edge rule missing`);
    }
  }
  checkDecoys(x, where);
  if (truth === null) {
    assert.equal(meta.sheetNo, null);
    return;
  }
  const d = truth.d;
  assert.ok(d >= 0.08 && d <= 0.25, `${where}: d ${d}`);
  // the strip lies inside the sheet
  const bw = bx1 - bx0, bh = by1 - by0;
  const strip = truth.edge === "right" ? [bx1 - d * bw, by0, bx1, by1]
    : truth.edge === "left" ? [bx0, by0, bx0 + d * bw, by1]
    : truth.edge === "bottom" ? [bx0, by1 - d * bh, bx1, by1] : [bx0, by0, bx1, by0 + d * bh];
  assert.ok(strip[0] >= 0 && strip[1] >= 0 && strip[2] <= W && strip[3] <= H && strip[0] < strip[2] && strip[1] < strip[3], `${where}: strip ${strip}`);
  // tokens whose centers lie in the truth strip
  const inStrip = sheet.tokens.filter((t) => {
    const [u, v] = toStripUV(truth, ...tokenCenter(t));
    return u >= 0 && u <= 1 && v >= 0 && v <= d;
  });
  assert.ok(inStrip.length >= 15, `${where}: ${inStrip.length} strip tokens`);
  // the sheet number: in the strip, the largest pattern match there, in the
  // far-end half and the outer 60% of the depth
  assert.ok(meta.sheetNo && TB_SHEETNO_RE.test(meta.sheetNo), `${where}: sheetNo ${meta.sheetNo}`);
  assert.equal(meta.fields!.sheetNo, meta.sheetNo);
  const matches = inStrip.filter((t) => TB_SHEETNO_RE.test(t.str));
  const biggest = matches.reduce((a, b) => (b.h > a.h ? b : a));
  assert.equal(biggest.str, meta.sheetNo, `${where}: biggest strip match`);
  assert.equal(matches.filter((t) => t.h === biggest.h).length, 1, `${where}: unique biggest`);
  const [u, v] = toStripUV(truth, ...tokenCenter(biggest));
  assert.ok(u >= 0.5, `${where}: sheet number u ${u}`);
  assert.ok(v <= 0.6 * d, `${where}: sheet number depth ${v / d}`);
  // the inner rule: a chain parallel to the edge at depth d, ending on the far-end border
  if (meta.frame !== "none") {
    const along = ALONG(truth.edge);
    const chain = sheet.lines.filter((l) => {
      if (along === "x" ? !isH(l) : !isV(l)) return false;
      const [, v0] = toStripUV(truth, l.x0, l.y0);
      return Math.abs(v0 - d) < 1e-6;
    });
    assert.ok(chain.length >= 2, `${where}: chain pieces ${chain.length}`);
    const us = chain.flatMap((l) => [toStripUV(truth, l.x0, l.y0)[0], toStripUV(truth, l.x1, l.y1)[0]]);
    const lo = Math.min(...us), hi = Math.max(...us);
    assert.ok(Math.abs(hi - 1) < 1e-6, `${where}: chain far end ${hi}`);
    assert.ok(Math.abs(hi - lo - meta.cover!) < 1e-6, `${where}: chain cover ${hi - lo} vs ${meta.cover}`);
    if (meta.frame === "full") assert.ok(Math.abs(lo) < 1e-6 && meta.cover === 1);
  } else {
    // no rule parallel to the edge at depth d
    assert.ok(!sheet.lines.some((l) => Math.abs(toStripUV(truth, l.x0, l.y0)[1] - d) < 1e-6 && (ALONG(truth.edge) === "x" ? isH(l) : isV(l))), `${where}: frame none has a chain`);
  }
}

describe("truth is self-consistent", () => {
  for (const [name, build] of NAMED) {
    test(name, () => {
      const s = build();
      s.sheets.forEach((x, i) => checkSheet(x, `${name}[${i}] ${x.sheet.key}`));
    });
  }
  test("random sets across seeds", () => {
    for (let seed = 1; seed <= 20; seed++) {
      randomSet(seed).sheets.forEach((x, i) => checkSheet(x, `randomSet(${seed})[${i}]`));
    }
  });
  test("truth lives outside DetectSheet and has exactly the documented shape", () => {
    for (const [, build] of NAMED) {
      for (const x of build().sheets) {
        assert.deepEqual(Object.keys(x.sheet).sort(), ["h", "key", "lines", "pageIn", "source", "tokens", "w"]);
        if (x.truth) assert.deepEqual(Object.keys(x.truth).sort(), ["border", "d", "edge", "family"] satisfies (keyof Truth)[]);
      }
    }
  });
});
