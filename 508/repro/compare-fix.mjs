// Builds results-compare.md from results-base.json + results-fix.json.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
const D = path.dirname(new URL(import.meta.url).pathname);
const B = JSON.parse(fs.readFileSync(path.join(D, 'results-base.json')));
const F = JSON.parse(fs.readFileSync(path.join(D, 'results-fix.json')));
const out = [];
const p = (...a) => out.push(a.join(''));
const ae = (a, b) => {
  try { execFileSync('/opt/homebrew/bin/compare', ['-metric', 'AE', a, b, 'null:'], { stdio: ['ignore', 'pipe', 'pipe'] }); return 0; }
  catch (e) { const s = String(e.stderr || e.stdout).trim(); const n = parseFloat(s.split(/\s/)[0]); return Number.isFinite(n) ? n : s; }
};
const sum = (runs, k) => runs.map((r) => r.io?.[k] ?? 'n/a').join(',');
const last = (r) => r.rows[r.rows.length - 1];
p('# Tile-leak: base vs fix\n');
p(`- base: ${B.head} (${B.worktree}) ${B.date}`);
p(`- fix: ${F.head} (${F.worktree}) ${F.date}\n`);
p('## Checkpoints (per run)\n');
p('| scenario | run | checkpoint | base fonts/tile | fix fonts/tile | base heap MB | fix heap MB | base backing MB | fix backing MB | base opens/closes | fix opens/closes | fix live keys | base chip | fix chip | fix tile workers live/ever |');
p('|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|');
for (const [name, sc] of Object.entries(F.scenarios)) for (const fr of sc.runs) {
  const br = B.scenarios[name]?.runs.find((r) => r.run === fr.run);
  for (const frow of fr.rows || []) {
    const brow = br?.rows.find((x) => x.at === frow.at) || {};
    p(`| ${name} | ${fr.run} | ${frow.at} | ${brow.fontsPerTile ?? '-'} | ${frow.fontsPerTile} | ${brow.tileHeapUsedMB ?? '-'} | ${frow.tileHeapUsedMB} | ${brow.tileBackingStoreMB ?? '-'} | ${frow.tileBackingStoreMB} | ${brow.opensPerTile?.[0] ?? '-'}/${brow.closesPerTile?.[0] ?? '-'} | ${frow.opensPerTile}/${frow.closesPerTile} | ${frow.liveKeysPerTile} | ${brow.chip ?? '-'} | ${frow.chip} | ${frow.tileWorkers}/${frow.tileWorkersEverAttached} |`);
  }
}
p('\n## Per-run IO / errors / timing\n');
p('| scenario | run | flip→idle med/max base | fix | exceptions b/f | console err b/f | [tiles] b/f | log err b/f | closeBeforeReady b/f | readyAfterClose b/f | readyUnmatched b/f | sheetClosedReplies b/f | closeWithUnanswered b/f | conclusive b/f |');
p('|---|---|---|---|---|---|---|---|---|---|---|---|---|---|');
for (const [name, sc] of Object.entries(F.scenarios)) for (const fr of sc.runs) {
  const bsc = B.scenarios[name]; const br = bsc?.runs.find((r) => r.run === fr.run) || {};
  const e = (r, k) => r.errorCounts?.[k] ?? '-'; const io = (r, k) => r.io?.[k] ?? '-';
  const t = (r) => r.flipTimeToIdleMs ? `${r.flipTimeToIdleMs.median}/${r.flipTimeToIdleMs.max}` : '-';
  p(`| ${name} | ${fr.run} | ${t(br)} | ${t(fr)} | ${e(br, 'exceptions')}/${e(fr, 'exceptions')} | ${e(br, 'consoleErrors')}/${e(fr, 'consoleErrors')} | ${e(br, 'tilesMessages')}/${e(fr, 'tilesMessages')} | ${e(br, 'logErrors')}/${e(fr, 'logErrors')} | ${io(br, 'closeBeforeReady')}/${io(fr, 'closeBeforeReady')} | ${io(br, 'readyAfterClose')}/${io(fr, 'readyAfterClose')} | ${io(br, 'readyUnmatched')}/${io(fr, 'readyUnmatched')} | ${io(br, 'sheetClosedReplies')}/${io(fr, 'sheetClosedReplies')} | ${io(br, 'closeWithUnanswered')}/${io(fr, 'closeWithUnanswered')} | ${bsc?.conclusive ?? '-'}/${sc.conclusive} |`);
}
// [tiles] warning texts (first line), base vs fix
const texts = (J) => { const m = {}; for (const sc of Object.values(J.scenarios)) for (const r of sc.runs) for (const t of r.errors.tilesMessages) { const k = t.type + ': ' + t.text.split('\n')[0]; m[k] = (m[k] || 0) + 1; } return m; };
const tb = texts(B), tf = texts(F);
p('\n## [tiles] message texts (all scenarios)\n');
p('| text | base | fix |'); p('|---|---|---|');
for (const k of new Set([...Object.keys(tb), ...Object.keys(tf)])) p(`| ${k.replace(/\|/g, '\\|')} | ${tb[k] || 0} | ${tf[k] || 0} |`);
const logs = (J) => { const m = {}; for (const sc of Object.values(J.scenarios)) for (const r of sc.runs) for (const t of r.errors.logErrors) { const k = (t.text || '').replace(/localhost:\d+/g, 'localhost:PORT').slice(0, 110); m[k] = (m[k] || 0) + 1; } return m; };
const lb = logs(B), lf = logs(F);
p('\n## Log-entry errors (all scenarios)\n');
p('| text | base | fix |'); p('|---|---|---|');
for (const k of new Set([...Object.keys(lb), ...Object.keys(lf)])) p(`| ${k.replace(/\|/g, '\\|')} | ${lb[k] || 0} | ${lf[k] || 0} |`);
const exc = (J) => Object.entries(J.scenarios).flatMap(([n, sc]) => sc.runs.flatMap((r) => [...r.errors.exceptions, ...r.errors.consoleErrors].map((x) => `${n} run${r.run}: ${JSON.stringify(x).slice(0, 200)}`)));
const isProbe = (x) => /\[probe\]/.test(x); const ef = exc(F), eb = exc(B);
p(`\nException/console-error entries: fix ${ef.filter((x) => !isProbe(x)).length} real + ${ef.filter(isProbe).length} deliberate error-capture probe entries; base ${eb.filter((x) => !isProbe(x)).length} real + ${eb.filter(isProbe).length} probe.`);
for (const x of ef.filter((x) => !isProbe(x))) p('- REAL: ' + x);
// per-worker opens vs replies vs closes
p('\n## Per-worker opens / sheet replies / closes / live keys (end of run)\n');
p('| scenario | run | base | fix |'); p('|---|---|---|---|');
const pw = (r) => (r?.io?.perWorker || []).map((w) => w ? `${w.opens}/${w.replies}/${w.closes}/${w.liveKeys.length}` : 'n/a').join(' ');
for (const [name, sc] of Object.entries(F.scenarios)) for (const fr of sc.runs) p(`| ${name} | ${fr.run} | ${pw(B.scenarios[name]?.runs.find((r) => r.run === fr.run))} | ${pw(fr)} |`);
// scenario details
p('\n## Scenario details (fix)\n');
for (const [name, sc] of Object.entries(F.scenarios)) for (const r of sc.runs) {
  const keys = ['finalChip', 'clicks', 'clickSpanMs', 'tileAfterLastClick', 'settleOk', 'lastClickToLastTileMs', 'finalSheetPaints', 'ioBeforeClicks', 'tileWorkersAfterLoad', 'assertOneTileWorker', 'respawned', 'watchdogWarnings', 'pendingRightAfterFlip', 'waitedMs', 'idleAfterFlipMs', 'gapAfterLastRenderMs', 'darkLocalStorage', 'darkButtonTitle', 'zoomFlipDelayMs', 'cycles', 'idleTimeouts'];
  const d = Object.fromEntries(keys.filter((k) => r[k] !== undefined).map((k) => [k, r[k]]));
  p(`- ${name} run${r.run}: ${JSON.stringify(d).slice(0, 700)}`);
}
// screenshots
p('\n## Screenshots: fix vs base (sha256; AE pixel count vs each distinct base variant when sha differs)\n');
p('| scenario | run | step | fix chip | fix sha | same sha as base run | AE vs base variants |'); p('|---|---|---|---|---|---|---|');
for (const [name, sc] of Object.entries(F.scenarios)) for (const fr of sc.runs) for (const sh of fr.screenshots || []) {
  const bShots = (B.scenarios[name]?.runs || []).flatMap((r) => r.screenshots.filter((x) => x.step === sh.step).map((x) => ({ ...x, run: r.run })));
  const same = bShots.filter((x) => x.sha256 === sh.sha256).map((x) => 'run' + x.run);
  let aes = '';
  if (!same.length) {
    const variants = [...new Map(bShots.map((x) => [x.sha256, x])).values()];
    aes = variants.map((v) => `${v.file} (${v.chip}): ${ae(path.join(D, sh.file), path.join(D, v.file))}`).join('; ');
  }
  p(`| ${name} | ${fr.run} | ${sh.step} | ${sh.chip} | \`${sh.sha256.slice(0, 16)}\` | ${same.join(',') || 'none'} | ${aes} |`);
}
fs.writeFileSync(path.join(D, 'results-compare-raw.md'), out.join('\n') + '\n');
console.log(out.join('\n'));
