// Record observed engine behavior for every synthetic fixture, so expectations
// and per-case band baselines are PINNED to reality, never guessed. Run:
//   node --import tsx test/corpus/record.ts
// Emits a table to stderr and writes test/corpus/baseline.json for accept cases.
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { buildMask, floodRegion, traceRegion } from "../../src/lib/oneclick.ts";
import { score, type Ring } from "../../src/lib/polyscore.ts";
import { SYNTHETIC_FIXTURES, type CorpusCase } from "./fixtures.ts";

function goldenRings(g: CorpusCase["golden"]): Ring[] {
  if (!g || g.length === 0) return [];
  return Array.isArray(g[0][0]) ? (g as Ring[]) : [g as Ring];
}

const baseline: Record<string, { band: number; iou: number }> = {};
const rows: string[] = [];
for (const fx of SYNTHETIC_FIXTURES) {
  const { segs, meta } = fx.build();
  const mask = buildMask(segs, fx.imgW, fx.imgH, 3000, meta);
  for (const c of fx.cases) {
    const f = floodRegion(mask, c.seed[0], c.seed[1]);
    const key = `${fx.id} :: ${c.label}`;
    if (f.status !== "ok") {
      rows.push(`${key.padEnd(52)} status=${f.status}  softCount=${mask.softCount}`);
      continue;
    }
    const ring = traceRegion(f);
    const gold = goldenRings(c.golden);
    const s = gold.length ? score([ring], gold) : null;
    if (s) baseline[key] = { band: +s.band.toFixed(4), iou: +s.iou.toFixed(4) };
    rows.push(
      `${key.padEnd(52)} status=ok  hf=${f.hatchFiltered ? "Y" : "n"}  count=${f.count}` +
      (s ? `  band=${s.band.toFixed(3)}  iou=${s.iou.toFixed(3)}` : "  (no golden)") +
      (c.knownDefect ? "  [KNOWN-DEFECT]" : ""),
    );
  }
}

process.stderr.write(rows.join("\n") + "\n");
const path = fileURLToPath(new URL("./baseline.json", import.meta.url));
writeFileSync(path, JSON.stringify(baseline, null, 2) + "\n");
process.stderr.write(`\nwrote ${Object.keys(baseline).length} baselines → ${path}\n`);
