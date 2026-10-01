// The app's saved page reads (ocr:v1 cache entries from pageread-*.json) → the runs format g/recall.mts scores.
import { readFileSync, writeFileSync } from "node:fs";
const [outp, ...tags] = process.argv.slice(2);
const D = new URL("../data/", import.meta.url).pathname;
const runs = [];
for (const tag of tags) {
  const d = JSON.parse(readFileSync(`${D}pageread-${tag}.json`, "utf8"));
  for (const [k, e] of Object.entries(d.cache)) {
    const sheet = Number(k.split(":").pop()), f = 2 / e.rs;
    runs.push({ cfg: tag, sheet, opts: e.opts, rev: e.rev, totalMs: Math.round(e.ms), tiles: null, nRasters: e.rasters, clipped: e.lines.filter((l) => l.clipped).length,
      linesPx: e.lines.map((l) => ({ ...l, x: l.x * f, y: l.y * f, w: l.w * f, h: l.h * f })) });
  }
}
writeFileSync(outp, JSON.stringify({ runs }));
console.log(runs.map((r) => [r.cfg, r.sheet, r.opts, r.linesPx.length].join(" ")).join("\n"));
