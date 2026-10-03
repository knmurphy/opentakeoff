// Measures the tile-worker pdf.js document leak (#508: closeSheet never destroys
// the getDocument loading task) on the bundled sample plan, across scenarios.
//
// v2 (plan opentakeoff-508-plan.md §4 + amendment A11). The dev server for the
// worktree under test must already be running. Same script, unchanged, for base
// and for the fixed branch:
//
//   node measure-tile-leak.mjs --url http://localhost:5311/ \
//     --worktree /path/to/worktree --label base \
//     --scenario settled,rapid,zoomed,phone,dark      (or: all)
//     [--runs settled=3,rapid=2,zoomed=2,phone=1,dark=2] [--flips 10,30]
//     [--cdp-port 9411] [--out DIR] [--no-warmup] [--zoom-flip-delay MS]
//   node measure-tile-leak.mjs --label base --rebuild   (recompute diffs + md from the JSON)
//
// Writes results-<label>.json (rewritten after every scenario, so partial
// progress survives) and results-<label>.md (summary table), plus screenshots
// <label>-<scenario>-run<N>-<step>.png (sha256 recorded in the JSON).
//
// Scenarios
//   settled  load, then cumulative flips to each --flips checkpoint (default
//            0/10/30), waiting for tile idle after every flip. Per-flip
//            time-to-idle = click → last tile/tileError posted by any worker.
//   rapid    10 in-page clicks ~50 ms apart (no waiting), then settle (chip
//            stable + ≥1 tile posted after the last click + quiet window).
//            Run after the load has settled.
//            "Final sheet paints": flip away and back (settled) and compare the
//            screenshot sha with the post-rapid one.
//   rapidEarly  same 10 clicks, but starting the moment the Next button
//            exists (first sheet's initial open/paint still in flight).
//   zoomed   one settled zoom (screenshot), then cycles of ctrl+wheel zoom-in
//            with a page-side Worker.prototype.postMessage wrapper armed: the
//            first renderTile posted after the zoom triggers the flip click
//            --zoom-flip-delay ms later (default 0), so closeSheet is posted
//            while that render is in flight.
//   phone    iPhone userAgent via launchPersistentContext (device class is
//            fixed at module load: deviceClass.ts / tilePool.ts POOL_SIZE).
//            Asserts exactly 1 tile worker; flips; waits 35 s after the last
//            flip; asserts no "tile timed out"/"died — respawning" warning and
//            no second tile-worker target (respawn). Desktop viewport is kept.
//   dark     clicks the canvas ☾ invert (opentakeoff_dark — the path that
//            sends dark:true to the worker; the chrome theme never reaches the
//            worker), settles, flips twice, captures.
//
// Every run: Runtime.enable on the page and on every tile-worker session
// (before the worker's module runs). Collected verbatim: Runtime.exceptionThrown,
// console error-level calls, any page/worker console text containing "[tiles]",
// and page Log.entryAdded errors (network etc.).
//
// IO_HOOK (installed in each tile worker before its module runs) records per
// worker: incoming messages by type; outgoing by type; closeSheet arrivals
// while the key's current open generation had not yet posted sheetReady
// (closeBeforeReady); closeSheet arrivals while that key had unanswered,
// uncancelled renderTile requests (closeWithUnanswered / ...Renders);
// tileError replies containing "sheet closed"; sheetReady posted for a
// generation that was already closed (readyAfterClose — pairing is FIFO per
// key, an approximation); opens/closes and keys still open at measure time.
import { chromium } from 'playwright-core';
import { execSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const argv = process.argv.slice(2);
const args = {};
for (let i = 0; i < argv.length; i++) if (argv[i].startsWith('--')) {
  const k = argv[i].slice(2); const v = argv[i + 1];
  if (v === undefined || v.startsWith('--')) args[k] = true; else { args[k] = v; i++; }
}
const URL_ = args.url || 'http://localhost:5311/';
const WORKTREE = args.worktree || '';
const FLIPS = String(args.flips || '10,30').split(',').map(Number);
const LABEL = args.label || 'run';
const OUT = args.out || path.dirname(new URL(import.meta.url).pathname);
const CDP_PORT = Number(args['cdp-port'] || 9411);
const ALL = ['settled', 'rapid', 'rapidEarly', 'zoomed', 'phone', 'dark'];
const SCENARIOS = (!args.scenario || args.scenario === 'all') ? ALL : String(args.scenario).split(',');
const RUNS = { settled: 3, rapid: 2, rapidEarly: 2, zoomed: 2, phone: 1, dark: 2 };
if (args.runs) for (const kv of String(args.runs).split(',')) { const [k, v] = kv.split('='); if (v) RUNS[k] = Number(v); else RUNS.settled = Number(k); }
const IPHONE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
const VIEWPORT = { width: 1400, height: 900 };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const head = WORKTREE ? execSync(`git -C ${JSON.stringify(WORKTREE)} rev-parse HEAD`).toString().trim() : null;
const sha256 = (f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
// Differing-pixel count (any channel) and bounding box via ImageMagick 7, whole
// frame and within the sheet canvas region (CANVAS_CROP: below the toolbars,
// right of the tool rail, above the status bar). null when magick is missing.
const CANVAS_CROP = '1344x656+56+216';
const diffPx = (a, b) => { const run = (crop) => { try {
  const img = (f) => (crop ? `\\( ${JSON.stringify(f)} -crop ${crop} +repage \\)` : JSON.stringify(f));
  const out = execSync(`magick ${img(a)} ${img(b)} -compose difference -composite -separate -evaluate-sequence max -threshold 0 -format "%[fx:round(mean*w*h)] %@" info: 2>/dev/null`).toString().trim().split(' ');
  return { pixels: Number(out[0]), bbox: out[0] === '0' ? null : out[1] }; } catch { return null; } };
  return { whole: run(null), canvas: run(CANVAS_CROP) }; };
const median = (a) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

const IO_HOOK = `(() => {
  const io = self.__io = { last: Date.now(), lastTileOut: 0, lastRenderIn: 0, tilesOut: 0, inByType: {}, outByType: {}, renderDark: 0,
    opens: 0, openWhileOpen: 0, closes: 0, closeNotOpen: 0, closeBeforeReady: 0, closeWithUnanswered: 0, closeUnansweredRenders: 0,
    closeWithOnlyCancelledPending: 0, sheetClosedReplies: 0, readyAfterClose: 0, readyUnmatched: 0, sheetErrorAfterClose: 0,
    renderNotOpen: 0, inboundWhileRenderPending: 0, inboundWhileOpenPending: 0, renderMs: [], tileErrorSamples: [], sheetErrorSamples: [], log: [] };
  const t0 = Date.now();
  const ev = (d, m) => { io.log.push([Date.now() - t0, d, m.type, m.sheetKey || '', m.reqId || 0]); if (io.log.length > 300) io.log.shift(); };
  const startedAt = new Map(); // reqId -> arrival time
  const fifo = new Map();   // key -> [generation] awaiting sheetReady/sheetError (FIFO approximation)
  const live = new Map();   // key -> current open generation (mirrors the worker's sheets map)
  const pending = new Map(); // reqId -> key (renderTile not yet answered, not cancelled)
  const cancelled = new Map(); // reqId -> key (cancelled before an answer; base stays silent for these)
  self.addEventListener('message', (e) => {
    const m = e.data || {}; io.last = Date.now(); io.inByType[m.type] = (io.inByType[m.type] || 0) + 1; ev('in', m);
    if (pending.size) io.inboundWhileRenderPending++;
    for (const g of live.values()) if (!g.ready) { io.inboundWhileOpenPending++; break; }
    if (m.type === 'openSheet') {
      if (live.has(m.sheetKey)) { io.openWhileOpen++; return; }
      const g = { ready: false, closed: false }; live.set(m.sheetKey, g);
      if (!fifo.has(m.sheetKey)) fifo.set(m.sheetKey, []); fifo.get(m.sheetKey).push(g); io.opens++;
    } else if (m.type === 'closeSheet') {
      io.closes++;
      const g = live.get(m.sheetKey);
      if (!g) io.closeNotOpen++; else { if (!g.ready) io.closeBeforeReady++; g.closed = true; live.delete(m.sheetKey); }
      let n = 0, c = 0;
      for (const k of pending.values()) if (k === m.sheetKey) n++;
      for (const k of cancelled.values()) if (k === m.sheetKey) c++;
      if (n) { io.closeWithUnanswered++; io.closeUnansweredRenders += n; } else if (c) io.closeWithOnlyCancelledPending++;
    } else if (m.type === 'renderTile') {
      io.lastRenderIn = Date.now(); pending.set(m.reqId, m.sheetKey); startedAt.set(m.reqId, Date.now()); if (m.dark) io.renderDark++; if (!live.has(m.sheetKey)) io.renderNotOpen++;
    } else if (m.type === 'cancel') {
      if (pending.has(m.reqId)) { cancelled.set(m.reqId, pending.get(m.reqId)); pending.delete(m.reqId); }
    }
  });
  const pm = self.postMessage.bind(self);
  self.postMessage = (m, t) => {
    io.last = Date.now();
    if (m && m.type) {
      ev('out', m);
      io.outByType[m.type] = (io.outByType[m.type] || 0) + 1;
      if (m.type === 'tile' || m.type === 'tileError') {
        io.tilesOut++; io.lastTileOut = Date.now(); pending.delete(m.reqId); cancelled.delete(m.reqId);
        if (startedAt.has(m.reqId)) { io.renderMs.push(Date.now() - startedAt.get(m.reqId)); startedAt.delete(m.reqId); if (io.renderMs.length > 500) io.renderMs.shift(); }
        if (m.type === 'tileError') {
          if (/sheet closed/.test(String(m.message))) io.sheetClosedReplies++;
          if (io.tileErrorSamples.length < 20) io.tileErrorSamples.push(String(m.message).slice(0, 200) + ' [key=' + m.sheetKey + ' live=' + [...live.keys()].join('|') + ']');
        }
      } else if (m.type === 'sheetReady' || m.type === 'sheetError') {
        // Prefer the current live generation if it hasn't replied (exact when only
        // live generations reply, as after the fix); otherwise the oldest
        // unreplied generation (base: closed generations still reply).
        const q = fifo.get(m.sheetKey) || []; const cur = live.get(m.sheetKey);
        let g = cur && !cur.ready && q.includes(cur) ? cur : q[0];
        if (g) q.splice(q.indexOf(g), 1);
        if (!g) io.readyUnmatched++;
        else { g.ready = true; if (g.closed) { if (m.type === 'sheetReady') io.readyAfterClose++; else io.sheetErrorAfterClose++; } }
        if (m.type === 'sheetError') {
          if (live.get(m.sheetKey) === g) live.delete(m.sheetKey);
          if (io.sheetErrorSamples.length < 20) io.sheetErrorSamples.push(String(m.message).slice(0, 200));
        }
      }
    }
    return pm(m, t);
  };
  self.__ioSnap = () => JSON.stringify(Object.assign({}, io, { liveKeys: [...live.keys()], pendingNow: pending.size, cancelledSilentNow: cancelled.size }));
})()`;

// ---- minimal flattened CDP client -----------------------------------------
class CDP {
  constructor(ws) { this.ws = ws; this.id = 0; this.pending = new Map(); this.handlers = []; this.lastEvent = Date.now();
    ws.addEventListener('message', (ev) => { const m = JSON.parse(ev.data);
      if (m.id && this.pending.has(m.id)) { const { res, rej } = this.pending.get(m.id); this.pending.delete(m.id); m.error ? rej(new Error(m.error.message)) : res(m.result); }
      else if (m.method) for (const h of this.handlers) h(m); }); }
  static async connect(wsUrl) { const ws = new WebSocket(wsUrl); await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; }); return new CDP(ws); }
  send(method, params = {}, sessionId) { const id = ++this.id; const msg = { id, method, params }; if (sessionId) msg.sessionId = sessionId;
    this.ws.send(JSON.stringify(msg)); return new Promise((res, rej) => { this.pending.set(id, { res, rej });
      setTimeout(() => { if (this.pending.has(id)) { this.pending.delete(id); rej(new Error(`timeout ${method}`)); } }, 15000); }); }
  on(h) { this.handlers.push(h); }
  close() { try { this.ws.close(); } catch { /* gone */ } }
}

function rssOf(marker) {
  // RSS (MB) of the Chromium process tree for this profile dir.
  const rows = execSync('ps -axo pid=,ppid=,rss=,command=').toString().split('\n')
    .map((l) => l.match(/^\s*(\d+)\s+(\d+)\s+(\d+)\s+(.*)$/)).filter(Boolean)
    .map(([, pid, ppid, rss, cmd]) => ({ pid: +pid, ppid: +ppid, rss: +rss, cmd }));
  const roots = rows.filter((r) => r.cmd.includes(marker) && !rows.some((q) => q.pid === r.ppid && q.cmd.includes(marker)));
  const keep = new Set(roots.map((r) => r.pid));
  let grew = true; while (grew) { grew = false; for (const r of rows) if (!keep.has(r.pid) && keep.has(r.ppid)) { keep.add(r.pid); grew = true; } }
  const kb = rows.filter((r) => keep.has(r.pid)).reduce((a, r) => a + r.rss, 0);
  return { rssMB: +(kb / 1024).toFixed(1), procs: keep.size };
}

const argText = (a) => (a.value !== undefined ? (typeof a.value === 'string' ? a.value : JSON.stringify(a.value)) : (a.description || a.type));

// ---- one browser session ----------------------------------------------------
async function openSession(scenario, runIdx, { userAgent } = {}) {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), `otk-leak-${LABEL}-${scenario}-`));
  const ctx = await chromium.launchPersistentContext(profile, {
    headless: true, viewport: VIEWPORT, ...(userAgent ? { userAgent } : {}), args: [`--remote-debugging-port=${CDP_PORT}`] });
  const page = ctx.pages()[0] || await ctx.newPage();
  await page.goto('about:blank');
  const ver = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/version`)).json();
  const cdp = await CDP.connect(ver.webSocketDebuggerUrl);
  const tag = `[${LABEL} ${scenario} run${runIdx}]`;
  const errors = { exceptions: [], consoleErrors: [], tilesMessages: [], logErrors: [] };
  const sessions = new Map(); // sessionId -> { type, url, parent, alive, isTile }
  let pageSid = null;
  cdp.on(async (m) => {
    if (m.method === 'Target.attachedToTarget') {
      const { sessionId, targetInfo } = m.params;
      const isTile = /pdfTile\.worker/.test(targetInfo.url);
      sessions.set(sessionId, { type: targetInfo.type, url: targetInfo.url, parent: m.sessionId || null, alive: true, isTile, attachedAt: Date.now() });
      cdp.lastEvent = Date.now();
      (async () => {
        if (isTile) {
          await cdp.send('Runtime.evaluate', { expression: IO_HOOK }, sessionId).catch(() => {});
          await cdp.send('Runtime.enable', {}, sessionId).catch(() => {}); // before the module runs
        }
        await cdp.send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: true, flatten: true }, sessionId).catch(() => {});
        await cdp.send('Runtime.runIfWaitingForDebugger', {}, sessionId).catch(() => {});
      })();
    } else if (m.method === 'Target.detachedFromTarget') {
      const s = sessions.get(m.params.sessionId); if (s) { s.alive = false; s.detachedAt = Date.now(); } cdp.lastEvent = Date.now();
    } else if (m.method === 'Runtime.exceptionThrown') {
      const d = m.params.exceptionDetails || {};
      const src = m.sessionId === pageSid ? 'page' : (sessions.get(m.sessionId)?.isTile ? 'tileWorker' : 'other');
      errors.exceptions.push({ src, text: d.text, description: d.exception?.description?.slice(0, 500), url: d.url, line: d.lineNumber });
    } else if (m.method === 'Runtime.consoleAPICalled') {
      const src = m.sessionId === pageSid ? 'page' : (sessions.get(m.sessionId)?.isTile ? 'tileWorker' : 'other');
      const text = (m.params.args || []).map(argText).join(' ').slice(0, 500);
      if (m.params.type === 'error' || m.params.type === 'assert') errors.consoleErrors.push({ src, type: m.params.type, text });
      if (text.includes('[tiles]')) errors.tilesMessages.push({ src, type: m.params.type, text, t: Date.now() });
    } else if (m.method === 'Log.entryAdded') {
      const e = m.params.entry; if (e.level === 'error') errors.logErrors.push({ source: e.source, text: e.text?.slice(0, 300), url: e.url });
    }
  });
  const targets = (await cdp.send('Target.getTargets')).targetInfos;
  const pt = targets.find((t) => t.type === 'page' && t.url === 'about:blank');
  ({ sessionId: pageSid } = await cdp.send('Target.attachToTarget', { targetId: pt.targetId, flatten: true }));
  sessions.set(pageSid, { type: 'page', url: 'about:blank', parent: null, alive: true, isTile: false });
  await cdp.send('Runtime.enable', {}, pageSid);
  await cdp.send('Log.enable', {}, pageSid);
  await cdp.send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: true, flatten: true }, pageSid);

  const tileSids = () => [...sessions.entries()].filter(([, s]) => s.alive && s.isTile).map(([sid]) => sid);
  const census = () => {
    const live = [...sessions.entries()].filter(([, s]) => s.alive && s.type !== 'page');
    const tiles = new Set(tileSids());
    return { totalWorkers: live.length, tileWorkers: tiles.size,
      nestedUnderTile: live.filter(([, s]) => tiles.has(s.parent)).length,
      tileWorkersEverAttached: [...sessions.values()].filter((s) => s.isTile).length,
      everAttached: [...sessions.values()].filter((s) => s.type !== 'page').length };
  };
  const ioSnaps = async () => { const out = [];
    for (const sid of tileSids()) { try { const r = await cdp.send('Runtime.evaluate', { expression: 'self.__ioSnap ? self.__ioSnap() : "null"', returnByValue: true }, sid);
      out.push(JSON.parse(r.result.value)); } catch { out.push(null); } }
    return out; };
  const tileIO = async () => { let last = 0, lastTileOut = 0, tilesOut = 0, renderIn = 0, pendingNow = 0;
    for (const v of await ioSnaps()) if (v) { last = Math.max(last, v.last); lastTileOut = Math.max(lastTileOut, v.lastTileOut); tilesOut += v.tilesOut; renderIn += v.inByType.renderTile || 0; pendingNow += v.pendingNow; }
    return { last, lastTileOut, tilesOut, renderIn, pendingNow }; };
  // Idle = at least one tile/tileError posted after `sinceTs` (and tilesOut past
  // `baseline`), then no worker message in or out for quietMs.
  const tilesIdle = async ({ baseline = 0, sinceTs = 0, quietMs = 1500, maxMs = 60000, chipStable = false } = {}) => {
    const t0 = Date.now(); let chipPrev = null, chipSince = Date.now();
    while (Date.now() - t0 < maxMs) {
      const io = await tileIO();
      let chipOk = true;
      if (chipStable) { const c = await chipText(); if (c !== chipPrev) { chipPrev = c; chipSince = Date.now(); } chipOk = Date.now() - chipSince >= 1000; }
      if (io.tilesOut > baseline && io.lastTileOut > sinceTs && Date.now() - io.last >= quietMs && chipOk) return { ok: true, ms: Date.now() - t0, ...io };
      await sleep(200);
    }
    return { ok: false, ms: Date.now() - t0, ...(await tileIO()) };
  };
  const settle = async (quietMs = 1500, maxMs = 30000) => { const t0 = Date.now();
    while (Date.now() - t0 < maxMs) { if (Date.now() - cdp.lastEvent >= quietMs) return; await sleep(200); } };
  const heapOf = async (sid) => { try { await cdp.send('HeapProfiler.collectGarbage', {}, sid); } catch { /* n/a */ }
    try { return await cdp.send('Runtime.getHeapUsage', {}, sid); } catch { return null; } };
  // A11 font read: poll self.fonts.size every ~100 ms until 3 consecutive equal reads (cap 5 s).
  const fontsSettled = async (sid, capMs = 5000) => { const t0 = Date.now(); const reads = [];
    while (Date.now() - t0 < capMs) {
      try { const r = await cdp.send('Runtime.evaluate', { expression: 'self.fonts ? self.fonts.size : -1', returnByValue: true }, sid); reads.push(r.result.value); } catch { reads.push(null); }
      const n = reads.length; if (n >= 3 && reads[n - 1] === reads[n - 2] && reads[n - 2] === reads[n - 3]) return { fonts: reads[n - 1], settleMs: Date.now() - t0, reads: n, capped: false };
      await sleep(100);
    }
    return { fonts: reads[reads.length - 1], settleMs: Date.now() - t0, reads: reads.length, capped: true, readSeq: reads };
  };
  const mb = (b) => +(b / 1048576).toFixed(1);
  const measure = async (label) => {
    await settle();
    const c = census();
    const perTile = [];
    for (const sid of tileSids()) {
      const f = await fontsSettled(sid);
      const h = await heapOf(sid);
      let io = null; try { const r = await cdp.send('Runtime.evaluate', { expression: 'self.__ioSnap ? self.__ioSnap() : "null"', returnByValue: true }, sid); io = JSON.parse(r.result.value); if (io) { delete io.log; io.renderMsMedian = median(io.renderMs); io.renderMsMax = io.renderMs.length ? Math.max(...io.renderMs) : null; delete io.renderMs; } } catch { /* gone */ }
      let fakeWorker = null; try { fakeWorker = (await cdp.send('Runtime.evaluate', { expression: '!!globalThis.pdfjsWorker', returnByValue: true }, sid)).result.value; } catch { /* gone */ }
      perTile.push({ fonts: f.fonts, fontsSettleMs: f.settleMs, fontsCapped: f.capped, fakeWorker,
        usedMB: h ? mb(h.usedSize) : null, backingStoreMB: h ? mb(h.backingStorageSize || 0) : null, io });
    }
    const pageHeap = await heapOf(pageSid);
    const sum = (k) => +perTile.reduce((a, t) => a + (t[k] || 0), 0).toFixed(1);
    const row = { at: label, chip: await chipText(), ...c,
      fontsPerTile: perTile.map((t) => t.fonts), fontsTotal: perTile.reduce((a, t) => a + (t.fonts > 0 ? t.fonts : 0), 0),
      fontsSettleMsMax: Math.max(0, ...perTile.map((t) => t.fontsSettleMs)), fontsAnyCapped: perTile.some((t) => t.fontsCapped),
      tileHeapUsedMB: sum('usedMB'), tileBackingStoreMB: sum('backingStoreMB'),
      pageHeap: pageHeap && { usedMB: mb(pageHeap.usedSize), backingStoreMB: mb(pageHeap.backingStorageSize || 0) },
      liveKeysPerTile: perTile.map((t) => t.io?.liveKeys?.length ?? null),
      opensPerTile: perTile.map((t) => t.io?.opens ?? null), closesPerTile: perTile.map((t) => t.io?.closes ?? null),
      perTile, process: rssOf(profile) };
    console.log(`${tag} ${label} chip=${row.chip} tile=${c.tileWorkers}/${c.tileWorkersEverAttached}ever fonts=[${row.fontsPerTile}] settle<=${row.fontsSettleMsMax}ms ` +
      `heap=${row.tileHeapUsedMB}MB backing=${row.tileBackingStoreMB}MB liveKeys=[${row.liveKeysPerTile}] opens=[${row.opensPerTile}] closes=[${row.closesPerTile}] rss=${row.process.rssMB}MB`);
    return row;
  };
  const chipText = () => page.evaluate(() => (document.body.innerText.match(/\b(\d+)\/(\d+)\b/) || [])[0]).catch(() => null);
  const shots = [];
  const shot = async (step) => {
    const file = path.join(OUT, `${LABEL}-${scenario}-run${runIdx}-${step}.png`);
    await page.screenshot({ path: file });
    const rec = { step, file: path.basename(file), sha256: sha256(file), chip: await chipText() };
    shots.push(rec); return rec;
  };
  const flipBtn = async () => { const next = page.locator('button[title="Next sheet"]');
    return (await next.isDisabled()) ? page.locator('button[title="Previous sheet"]') : next; };
  // One settled flip: click, wait for the chip to change, wait for tile idle.
  const flipTimes = []; let idleTimeouts = 0;
  const settledFlip = async () => {
    const before = await chipText(); const { tilesOut: baseline } = await tileIO();
    const btn = await flipBtn(); const tClick = Date.now();
    await btn.click();
    await page.waitForFunction((b) => ((document.body.innerText.match(/\b(\d+)\/(\d+)\b/) || [])[0]) !== b, before, { timeout: 15000 });
    const r = await tilesIdle({ baseline, sinceTs: tClick });
    if (!r.ok) idleTimeouts++; else flipTimes.push(r.lastTileOut - tClick);
    return r;
  };
  const load = async ({ wait = true } = {}) => {
    await page.goto(URL_);
    await page.getByRole('button', { name: /Load sample plan/ }).click();
    await page.getByText('Classic layout').click({ timeout: 30000 });
    await page.locator('button[title="Next sheet"]').waitFor({ timeout: 30000 });
    if (wait) { const r = await tilesIdle({ maxMs: 90000 }); if (!r.ok) idleTimeouts++; }
  };
  const errorSummary = () => ({
    exceptions: errors.exceptions.length, consoleErrors: errors.consoleErrors.length,
    tilesMessages: errors.tilesMessages.length, logErrors: errors.logErrors.length });
  const ioTotals = async () => { const snaps = await ioSnaps(); const keys = ['opens', 'closes', 'closeNotOpen', 'openWhileOpen', 'closeBeforeReady', 'closeWithUnanswered',
    'closeUnansweredRenders', 'closeWithOnlyCancelledPending', 'renderNotOpen', 'inboundWhileRenderPending', 'inboundWhileOpenPending', 'sheetClosedReplies', 'readyAfterClose', 'readyUnmatched', 'sheetErrorAfterClose', 'renderDark'];
    const tot = Object.fromEntries(keys.map((k) => [k, snaps.reduce((a, s) => a + (s?.[k] || 0), 0)]));
    tot.inByType = {}; tot.outByType = {};
    for (const s of snaps) if (s) { for (const [k, v] of Object.entries(s.inByType)) tot.inByType[k] = (tot.inByType[k] || 0) + v;
      for (const [k, v] of Object.entries(s.outByType)) tot.outByType[k] = (tot.outByType[k] || 0) + v; }
    tot.replies = snaps.reduce((a, s) => a + (s ? (s.outByType.sheetReady || 0) + (s.outByType.sheetError || 0) : 0), 0);
    tot.perWorker = snaps.map((s) => s && { opens: s.opens, replies: (s.outByType.sheetReady || 0) + (s.outByType.sheetError || 0), closes: s.closes, liveKeys: s.liveKeys, closeBeforeReady: s.closeBeforeReady,
      closeWithUnanswered: s.closeWithUnanswered, sheetClosedReplies: s.sheetClosedReplies, readyAfterClose: s.readyAfterClose,
      renderNotOpen: s.renderNotOpen, renderMsMedian: median(s.renderMs), renderMsMax: s.renderMs.length ? Math.max(...s.renderMs) : null, renderMsN: s.renderMs.length,
      inByType: s.inByType, outByType: s.outByType, pendingNow: s.pendingNow, cancelledSilentNow: s.cancelledSilentNow, tileErrorSamples: s.tileErrorSamples, sheetErrorSamples: s.sheetErrorSamples, eventLogTail: s.log });
    return tot; };
  const finish = async (extra, { probe = true } = {}) => {
    const io = await ioTotals(); const c = census();
    const counts = errorSummary();
    // Instrument check (after counts are taken): a tile worker logs a console.error
    // and throws from a timer; both must be captured with src tileWorker.
    let instrumentLive = null;
    if (probe) {
      const sid = [...sessions.entries()].find(([, x]) => x.alive && x.isTile)?.[0];
      if (sid) {
        await cdp.send('Runtime.evaluate', { expression: "console.error('[probe] tile console.error'); setTimeout(() => { throw new Error('[probe] tile throw'); }, 0); 1" }, sid).catch(() => {});
        await sleep(800);
        instrumentLive = { consoleError: errors.consoleErrors.some((e) => e.src === 'tileWorker' && e.text.includes('[probe]')),
          exception: errors.exceptions.some((e) => e.src === 'tileWorker' && /\[probe\]/.test(`${e.text} ${e.description}`)) };
      }
    }
    const res = { run: runIdx, hardwareConcurrency: await page.evaluate(() => navigator.hardwareConcurrency).catch(() => null),
      userAgent: await page.evaluate(() => navigator.userAgent).catch(() => null), viewport: VIEWPORT,
      idleTimeouts, flipTimeToIdleMs: { n: flipTimes.length, median: median(flipTimes), max: flipTimes.length ? Math.max(...flipTimes) : null, all: flipTimes },
      census: c, errorCounts: counts, instrumentLive, errors, io, screenshots: shots, ...extra };
    await ctx.close().catch(() => {}); cdp.close();
    fs.rmSync(profile, { recursive: true, force: true });
    console.log(`${tag} done errors=${JSON.stringify(res.errorCounts)} io: closeBeforeReady=${io.closeBeforeReady} closeWithUnanswered=${io.closeWithUnanswered}(${io.closeUnansweredRenders} renders) ` +
      `sheetClosedReplies=${io.sheetClosedReplies} readyAfterClose=${io.readyAfterClose} opens=${io.opens} closes=${io.closes} flipIdle med/max=${res.flipTimeToIdleMs.median}/${res.flipTimeToIdleMs.max}ms`);
    return res;
  };
  return { page, cdp, tag, ioTotals, census, tileIO, tilesIdle, measure, shot, settledFlip, load, finish, chipText, flipBtn, ioSnaps, errors, flipTimes, get idleTimeouts() { return idleTimeouts; }, bumpIdleTimeout: () => idleTimeouts++ };
}

// ---- scenarios ----------------------------------------------------------------
async function runSettled(i) {
  const s = await openSession('settled', i);
  await s.load(); await s.shot('after-load');
  const rows = [await s.measure('flips=0')];
  let done = 0;
  for (const target of FLIPS) { while (done < target) { await s.settledFlip(); done++; } rows.push(await s.measure(`flips=${done}`)); }
  await s.shot(`after-${done}-flips`);
  return s.finish({ rows });
}

async function runRapid(i, { early = false } = {}) {
  // early: start clicking the moment the Next button exists (first sheet's
  // initial open/paint still in flight) instead of after the load settles.
  const s = await openSession(early ? 'rapidEarly' : 'rapid', i);
  const rows = [];
  if (early) await s.load({ wait: false });
  else { await s.load(); await s.shot('after-load'); rows.push(await s.measure('flips=0')); }
  const { tilesOut: baseline } = early ? { tilesOut: 0 } : await s.tileIO();
  const ioBeforeClicks = await s.ioTotals();
  const clickLog = await s.page.evaluate(async () => {
    const log = [];
    for (let k = 0; k < 10; k++) {
      const next = document.querySelector('button[title="Next sheet"]');
      const btn = next && !next.disabled ? next : document.querySelector('button[title="Previous sheet"]');
      btn.click(); log.push({ t: Date.now(), title: btn.title });
      await new Promise((r) => setTimeout(r, 50));
    }
    return log;
  });
  const tLast = clickLog[clickLog.length - 1].t;
  const r = await s.tilesIdle({ baseline, sinceTs: tLast, chipStable: true, maxMs: 90000 });
  if (!r.ok) s.bumpIdleTimeout();
  const settleMs = r.lastTileOut ? r.lastTileOut - tLast : null;
  const finalShot = await s.shot('after-rapid');
  rows.push(await s.measure('after-rapid'));
  // reference: flip away and back (settled) — same sheet must paint the same
  await s.settledFlip(); await s.settledFlip();
  const refShot = await s.shot('after-away-and-back');
  rows.push(await s.measure('after-away-and-back'));
  return s.finish({ rows, ioBeforeClicks: { opens: ioBeforeClicks.opens, sheetReady: ioBeforeClicks.outByType.sheetReady || 0, renderTile: ioBeforeClicks.inByType.renderTile || 0, tilesOut: (ioBeforeClicks.outByType.tile || 0) + (ioBeforeClicks.outByType.tileError || 0) },
    clicks: clickLog.length, clickSpanMs: tLast - clickLog[0].t, clickTitles: clickLog.map((c) => c.title),
    finalChip: finalShot.chip, tileAfterLastClick: r.lastTileOut > tLast, settleOk: r.ok, lastClickToLastTileMs: settleMs,
    finalSheetPaints: { matchesAwayAndBack: finalShot.sha256 === refShot.sha256, chipEqual: finalShot.chip === refShot.chip, diffVsAwayAndBack: diffPx(path.join(OUT, finalShot.file), path.join(OUT, refShot.file)) } });
}

async function runZoomed(i, cycles = 5) {
  // A passive page-side wrapper on Worker.prototype.postMessage, armed per
  // cycle: the first renderTile posted after the zoom (the detail crop or a
  // finer base tile) schedules the flip click `delay` ms later, so the flip's
  // closeSheet reaches the workers while that render is in flight. Whether it
  // actually was in flight is read from the worker hook (closeWithUnanswered).
  const DELAY = Number(args['zoom-flip-delay'] ?? 0);
  const s = await openSession('zoomed', i);
  await s.load(); await s.shot('after-load');
  const rows = [await s.measure('flips=0')];
  await s.page.evaluate(() => {
    const orig = Worker.prototype.postMessage;
    Worker.prototype.postMessage = function (m) {
      const r = orig.apply(this, arguments);
      const a = window.__flipArm;
      if (a && a.armed && m && m.type === 'renderTile') {
        a.armed = false; a.renderAt = Date.now(); a.reqId = m.reqId;
        setTimeout(() => { const n = document.querySelector('button[title="Next sheet"]');
          const b = n && !n.disabled ? n : document.querySelector('button[title="Previous sheet"]'); a.clickAt = Date.now(); b.click(); }, a.delay);
      }
      return r;
    };
  });
  const zoom = async () => {
    await s.page.mouse.move(VIEWPORT.width / 2, VIEWPORT.height / 2);
    await s.page.keyboard.down('Control');
    await s.page.mouse.wheel(0, -100); await sleep(30); await s.page.mouse.wheel(0, -100);
    await s.page.keyboard.up('Control');
  };
  // evidence that the zoom works: zoom, let the detail crop paint, capture, then a plain settled flip
  { const { tilesOut: baseline } = await s.tileIO(); const t = Date.now(); await zoom();
    const r = await s.tilesIdle({ baseline, sinceTs: t }); if (!r.ok) s.bumpIdleTimeout();
    await s.shot('zoomed-in-settled'); await s.settledFlip(); }
  const cyc = [];
  for (let k = 0; k < cycles; k++) {
    const ioBefore = await s.ioTotals(); const chipBefore = await s.chipText(); const { tilesOut: baseline } = await s.tileIO();
    await s.page.evaluate((delay) => { window.__flipArm = { armed: true, delay }; }, DELAY);
    const t0 = Date.now();
    await zoom();
    let arm = null;
    try { await s.page.waitForFunction((b) => window.__flipArm.clickAt && ((document.body.innerText.match(/\b(\d+)\/(\d+)\b/) || [])[0]) !== b, chipBefore, { timeout: 15000 }); }
    catch (e) { console.log(`${s.tag} zoom cycle ${k}: no flip (${e.message.split('\n')[0]})`); }
    arm = await s.page.evaluate(() => window.__flipArm);
    const tClick = arm.clickAt || Date.now();
    const r = await s.tilesIdle({ baseline, sinceTs: tClick });
    if (!r.ok) s.bumpIdleTimeout(); else s.flipTimes.push(r.lastTileOut - tClick);
    const ioAfter = await s.ioTotals();
    const d = (k2) => ioAfter[k2] - ioBefore[k2];
    cyc.push({ zoomToRenderMs: arm.renderAt ? arm.renderAt - t0 : null, renderToClickMs: arm.clickAt && arm.renderAt ? arm.clickAt - arm.renderAt : null,
      closeWithUnanswered: d('closeWithUnanswered'), closeUnansweredRenders: d('closeUnansweredRenders'), closeBeforeReady: d('closeBeforeReady'),
      cancels: (ioAfter.inByType.cancel || 0) - (ioBefore.inByType.cancel || 0) });
  }
  await s.shot(`after-${cycles}-zoom-flips`);
  rows.push(await s.measure(`after-${cycles}-zoom-flips`));
  return s.finish({ rows, zoomFlipDelayMs: DELAY, cycles: cyc });
}

async function runPhone(i) {
  const s = await openSession('phone', i, { userAgent: IPHONE_UA });
  await s.load(); await s.shot('after-load');
  const rows = [await s.measure('flips=0')];
  const tileWorkersAfterLoad = s.census().tileWorkers;
  for (let k = 0; k < 4; k++) await s.settledFlip();
  rows.push(await s.measure('flips=4'));
  // last flip: start the >30 s watchdog window right after the click
  const before = await s.chipText(); const btn = await s.flipBtn(); const tClick = Date.now();
  await btn.click();
  await s.page.waitForFunction((b) => ((document.body.innerText.match(/\b(\d+)\/(\d+)\b/) || [])[0]) !== b, before, { timeout: 15000 });
  const pendingRightAfterFlip = (await s.tileIO()).pendingNow;
  // wait for tile idle, then until ≥31 s after the last renderTile any worker
  // received (the pool's watchdog is 30 s per request), and ≥35 s after the click
  const idle = await s.tilesIdle({ sinceTs: tClick, maxMs: 90000 }); if (!idle.ok) s.bumpIdleTimeout();
  let lastRenderIn = 0;
  for (;;) { lastRenderIn = Math.max(0, ...(await s.ioSnaps()).filter(Boolean).map((v) => v.lastRenderIn));
    if (Date.now() - lastRenderIn >= 31000 && Date.now() - tClick >= 35000) break; await sleep(500); }
  const gapAfterLastRenderMs = Date.now() - lastRenderIn;
  const watchdog = s.errors.tilesMessages.filter((m) => /timed out|died|respawn/.test(m.text));
  await s.shot('after-5-flips-watchdog-wait');
  rows.push(await s.measure('flips=5+watchdog-wait'));
  const c = s.census();
  return s.finish({ rows, tileWorkersAfterLoad, assertOneTileWorker: tileWorkersAfterLoad === 1 && c.tileWorkers === 1,
    respawned: c.tileWorkersEverAttached > 1, watchdogWarnings: watchdog, pendingRightAfterFlip, waitedMs: Date.now() - tClick, idleAfterFlipMs: idle.ms, gapAfterLastRenderMs }, { probe: false });
}

async function runDark(i) {
  const s = await openSession('dark', i);
  await s.load(); await s.shot('after-load');
  const { tilesOut: baseline } = await s.tileIO(); const t = Date.now();
  await s.page.locator('button[title^="Invert sheet"]').click();
  const r = await s.tilesIdle({ baseline, sinceTs: t }); if (!r.ok) s.bumpIdleTimeout();
  await s.shot('after-dark-toggle');
  const rows = [await s.measure('dark flips=0')];
  await s.settledFlip(); await s.settledFlip();
  await s.shot('after-2-flips-dark');
  rows.push(await s.measure('dark flips=2'));
  const darkOn = await s.page.evaluate(() => { try { return localStorage.getItem('opentakeoff_dark'); } catch { return null; } });
  return s.finish({ rows, darkLocalStorage: darkOn, darkButtonTitle: await s.page.locator('button[title="Sheet back to positive print"]').count() });
}

const RUNNERS = { settled: runSettled, rapid: (i) => runRapid(i), rapidEarly: (i) => runRapid(i, { early: true }), zoomed: runZoomed, phone: runPhone, dark: runDark };

// purpose-path conclusiveness (A11)
function conclusive(name, runs) {
  const sum = (k) => runs.reduce((a, r) => a + (r.io?.[k] || 0), 0);
  if (name === 'rapid' || name === 'rapidEarly') return sum('closeBeforeReady') + sum('closeWithUnanswered') > 0;
  if (name === 'zoomed') return sum('closeWithUnanswered') > 0;
  if (name === 'phone') return runs.every((r) => r.assertOneTileWorker);
  if (name === 'dark') return sum('renderDark') > 0;
  return sum('closes') > 0;
}

async function warmup() {
  // first browser load makes Vite optimize deps and reload the page; absorb that here
  const ctx = await chromium.launchPersistentContext(fs.mkdtempSync(path.join(os.tmpdir(), 'otk-warm-')), { headless: true, viewport: VIEWPORT });
  const page = ctx.pages()[0] || await ctx.newPage();
  try {
    await page.goto(URL_); await page.getByRole('button', { name: /Load sample plan/ }).click();
    await page.getByText('Classic layout').click({ timeout: 30000 });
    await page.locator('button[title="Next sheet"]').waitFor({ timeout: 30000 });
    await page.waitForTimeout(5000);
    await page.locator('button[title="Next sheet"]').click(); await page.waitForTimeout(3000);
  } catch (e) { console.log('warmup:', e.message); }
  await ctx.close();
}

const file = path.join(OUT, `results-${LABEL}.json`);
function postProcess(name, runs) {
  const ok = runs.filter((r) => !r.failed);
  const shaSets = {}; const files = {};
  for (const r of ok) for (const sh of r.screenshots) { (shaSets[sh.step] ||= []).push(sh.sha256); (files[sh.step] ||= []).push(sh.file); }
  for (const r of ok) if (r.finalSheetPaints) { const a = r.screenshots.find((x) => x.step === 'after-rapid'), b = r.screenshots.find((x) => x.step === 'after-away-and-back');
    r.finalSheetPaints.diffVsAwayAndBack = diffPx(path.join(OUT, a.file), path.join(OUT, b.file));
    r.finalSheetPaints.canvasIdentical = r.finalSheetPaints.diffVsAwayAndBack.canvas?.pixels === 0; }
  return { runs, conclusive: ok.length ? conclusive(name, ok) : false,
    screenshotStability: Object.fromEntries(Object.entries(shaSets).map(([k, v]) => [k, { identicalAcrossRuns: new Set(v).size === 1, distinct: new Set(v).size, n: v.length,
      diffVsRun1: new Set(v).size === 1 ? undefined : files[k].map((f) => diffPx(path.join(OUT, files[k][0]), path.join(OUT, f))) }])) };
}
let results;
if (args.rebuild) {
  // re-derive conclusiveness, screenshot diffs and the markdown from an existing results file
  results = JSON.parse(fs.readFileSync(file, 'utf8'));
  for (const [name, sc] of Object.entries(results.scenarios)) results.scenarios[name] = postProcess(name, sc.runs);
  fs.writeFileSync(file, JSON.stringify(results, null, 2));
} else {
results = { label: LABEL, url: URL_, worktree: WORKTREE, head, flipsCheckpoints: [0, ...FLIPS], runsPlan: RUNS, date: new Date().toISOString(), scenarios: {} };
if (!args['no-warmup']) await warmup();
for (const name of SCENARIOS) {
  const runs = [];
  for (let i = 1; i <= (RUNS[name] || 1); i++) {
    try { runs.push(await RUNNERS[name](i)); } catch (e) { console.log(`[${LABEL} ${name} run${i}] FAILED: ${e.stack}`); runs.push({ run: i, failed: String(e.stack).slice(0, 2000) }); }
  }
  results.scenarios[name] = postProcess(name, runs);
  fs.writeFileSync(file, JSON.stringify(results, null, 2));
  console.log(`wrote ${file} (${name})`);
}
}

// ---- markdown summary -----------------------------------------------------------
const md = [`# Tile-leak measurement: ${LABEL}`, '', `- url: ${URL_}`, `- worktree: ${WORKTREE}`, `- head: ${head}`, `- date: ${results.date}`, '',
  '| scenario | run | checkpoint | chip | tile workers (live/ever) | fonts per tile | fonts settle ms (max) | tile heap MB | tile backing MB | live keys per tile | opens / closes per tile |',
  '|---|---|---|---|---|---|---|---|---|---|---|'];
for (const [name, sc] of Object.entries(results.scenarios)) for (const r of sc.runs) {
  if (r.failed) { md.push(`| ${name} | ${r.run} | FAILED | | | | | | | | |`); continue; }
  for (const row of r.rows) md.push(`| ${name} | ${r.run} | ${row.at} | ${row.chip} | ${row.tileWorkers}/${row.tileWorkersEverAttached} | ${row.fontsPerTile.join(',')} | ${row.fontsSettleMsMax}${row.fontsAnyCapped ? ' (capped)' : ''} | ${row.tileHeapUsedMB} | ${row.tileBackingStoreMB} | ${row.liveKeysPerTile.join(',')} | ${row.opensPerTile.join(',')} / ${row.closesPerTile.join(',')} |`);
}
md.push('', '| scenario | run | conclusive | flip→idle median / max ms | exceptions | console errors | [tiles] msgs | log errors | closeBeforeReady | closeWithUnanswered (renders) | "sheet closed" replies | readyAfterClose | msgs dispatched while render / open pending | opens / sheet replies | error capture probe | renderTile for unopened key | idle timeouts |', '|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|');
for (const [name, sc] of Object.entries(results.scenarios)) for (const r of sc.runs) {
  if (r.failed) continue;
  md.push(`| ${name} | ${r.run} | ${sc.conclusive ? 'yes' : 'INCONCLUSIVE'} | ${r.flipTimeToIdleMs.median} / ${r.flipTimeToIdleMs.max} | ${r.errorCounts.exceptions} | ${r.errorCounts.consoleErrors} | ${r.errorCounts.tilesMessages} | ${r.errorCounts.logErrors} | ${r.io.closeBeforeReady} | ${r.io.closeWithUnanswered} (${r.io.closeUnansweredRenders}) | ${r.io.sheetClosedReplies} | ${r.io.readyAfterClose} | ${r.io.inboundWhileRenderPending} / ${r.io.inboundWhileOpenPending} | ${r.io.opens} / ${r.io.replies} | ${r.instrumentLive ? (r.instrumentLive.consoleError && r.instrumentLive.exception ? 'live' : 'DEAD ' + JSON.stringify(r.instrumentLive)) : 'n/a'} | ${r.io.renderNotOpen} | ${r.idleTimeouts} |`);
}
md.push('', '## Screenshots', '', '| scenario | run | step | chip | sha256 |', '|---|---|---|---|---|');
for (const [name, sc] of Object.entries(results.scenarios)) for (const r of sc.runs) for (const sh of r.screenshots || []) md.push(`| ${name} | ${r.run} | ${sh.step} | ${sh.chip} | \`${sh.sha256.slice(0, 16)}\` |`);
md.push('', '| scenario | step | identical across runs |', '|---|---|---|');
for (const [name, sc] of Object.entries(results.scenarios)) for (const [k, v] of Object.entries(sc.screenshotStability)) md.push(`| ${name} | ${k} | ${v.n < 2 ? `n/a (${v.n} run)` : v.identicalAcrossRuns ? 'yes' : `no (${v.distinct} distinct of ${v.n}; differing px vs run1 whole/canvas: ${v.diffVsRun1.map((d) => `${d.whole?.pixels}/${d.canvas?.pixels}`).join(', ')})`} |`);
const extras = [];
for (const nm of ['rapid', 'rapidEarly']) if (results.scenarios[nm]) for (const r of results.scenarios[nm].runs) if (!r.failed) extras.push(`- ${nm} run${r.run}: before clicks ${JSON.stringify(r.ioBeforeClicks)}; ${r.clicks} clicks over ${r.clickSpanMs} ms, final chip ${r.finalChip}, tile after last click: ${r.tileAfterLastClick}, last click → last tile ${r.lastClickToLastTileMs} ms, final sheet canvas identical to away-and-back: ${r.finalSheetPaints.canvasIdentical} (whole-frame sha equal: ${r.finalSheetPaints.matchesAwayAndBack}; differing px whole/canvas: ${r.finalSheetPaints.diffVsAwayAndBack.whole?.pixels}/${r.finalSheetPaints.diffVsAwayAndBack.canvas?.pixels}, bbox ${r.finalSheetPaints.diffVsAwayAndBack.whole?.bbox})`);
if (results.scenarios.zoomed) for (const r of results.scenarios.zoomed.runs) if (!r.failed) extras.push(`- zoomed run${r.run}: flip ${r.zoomFlipDelayMs} ms after the first post-zoom renderTile; per cycle closeWithUnanswered(renders)/renderToClickMs: ${r.cycles.map((c) => `${c.closeWithUnanswered}(${c.closeUnansweredRenders})/${c.renderToClickMs}`).join(', ')}`);
if (results.scenarios.phone) for (const r of results.scenarios.phone.runs) if (!r.failed) extras.push(`- phone run${r.run}: UA ${r.userAgent}; 1 tile worker: ${r.assertOneTileWorker}; respawned: ${r.respawned}; watchdog warnings: ${r.watchdogWarnings.length}; pending right after last flip: ${r.pendingRightAfterFlip}; flip→idle ${r.idleAfterFlipMs} ms; waited ${r.waitedMs} ms after the click, ${r.gapAfterLastRenderMs} ms after the last renderTile`);
if (results.scenarios.dark) for (const r of results.scenarios.dark.runs) if (!r.failed) extras.push(`- dark run${r.run}: opentakeoff_dark=${r.darkLocalStorage}, renderTile with dark:true = ${r.io.renderDark}`);
if (extras.length) md.push('', '## Scenario details', '', ...extras);
fs.writeFileSync(path.join(OUT, `results-${LABEL}.md`), md.join('\n') + '\n');
console.log(`wrote results-${LABEL}.md`);
