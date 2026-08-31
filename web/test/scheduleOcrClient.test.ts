// The main-thread schedule-OCR client (docs/SCHEDULE-OCR-BROWSER-SPEC.md step 6).
// The engine itself (PaddleOCR/onnxruntime-web) is browser-only and validated by
// Playwright; here we pin the state machine the client owns — probe → init →
// recognize → dispose, error propagation, id correlation, and the zero-copy
// transfer — with an injected fake worker + probe (no real Worker/server).
import { test } from "node:test";
import assert from "node:assert/strict";
import { createScheduleOcrClient, type WorkerLike, type ScanOcrStatus } from "../src/lib/scheduleOcrClient.js";

const geometry = { rect: { x0: 0, y0: 0, x1: 10, y1: 10 }, zoom: 1 };
const region = () => ({ rgba: new Uint8ClampedArray(4 * 10 * 10), width: 10, height: 10, geometry });
const installed = async () => ({ ok: true, contentType: "application/octet-stream" });

// A fake worker driven by a `responder(msg, reply)`: it echoes replies back
// through whatever onmessage the client currently has set.
function fakeWorker(responder: (msg: any, reply: (data: unknown) => void) => void): WorkerLike & { posted: { msg: any; transfer?: Transferable[] }[]; terminated: boolean } {
  const w: any = { onmessage: null, onerror: null, posted: [], terminated: false };
  w.postMessage = (msg: any, transfer?: Transferable[]) => {
    w.posted.push({ msg, transfer });
    Promise.resolve().then(() => responder(msg, (data) => w.onmessage?.({ data })));
  };
  w.terminate = () => { w.terminated = true; };
  return w;
}

const statuses = () => {
  const seen: ScanOcrStatus[] = [];
  return { seen, onStatus: (s: ScanOcrStatus) => seen.push(s) };
};

test("uninstalled: a missing model probe → false, status uninstalled, no worker spawned", async () => {
  let spawned = false;
  const { seen, onStatus } = statuses();
  const client = createScheduleOcrClient(onStatus, {
    probe: async () => ({ ok: false, contentType: "" }),
    spawnWorker: () => { spawned = true; return fakeWorker(() => {}); },
  });
  assert.equal(await client.ensureReady(), false);
  assert.equal(spawned, false);
  assert.deepEqual(seen.map((s) => s.phase), ["uninstalled"]);
});

test("SPA fallback (200 + index.html) reads as uninstalled, not ready", async () => {
  const client = createScheduleOcrClient(() => {}, {
    probe: async () => ({ ok: true, contentType: "text/html; charset=utf-8" }),
    spawnWorker: () => fakeWorker(() => {}),
  });
  assert.equal(await client.ensureReady(), false);
});

test("ready then recognize resolves with the worker's words", async () => {
  const words = [{ str: "CPT-1", x: 1, y: 2, w: 3, h: 4 }];
  const w = fakeWorker((msg, reply) => {
    if (msg.type === "init") reply({ type: "ready" });
    else if (msg.type === "recognize") reply({ type: "result", id: msg.id, words });
  });
  const client = createScheduleOcrClient(() => {}, { probe: installed, spawnWorker: () => w });
  assert.equal(await client.ensureReady(), true);
  const got = await client.recognize(region());
  assert.deepEqual(got, words);
  // the rgba buffer is transferred (zero-copy)
  const rec = w.posted.find((p) => p.msg.type === "recognize");
  assert.ok(rec?.transfer && rec.transfer.length === 1, "rgba buffer not transferred");
});

test("an init error → ensureReady false + error status (retryable)", async () => {
  const { seen, onStatus } = statuses();
  const w = fakeWorker((msg, reply) => { if (msg.type === "init") reply({ type: "error", message: "compile failed" }); });
  const client = createScheduleOcrClient(onStatus, { probe: installed, spawnWorker: () => w });
  assert.equal(await client.ensureReady(), false);
  assert.equal(seen.at(-1)?.phase, "error");
  assert.match((seen.at(-1) as { message: string }).message, /compile failed/);
});

test("a recognize error rejects", async () => {
  const w = fakeWorker((msg, reply) => {
    if (msg.type === "init") reply({ type: "ready" });
    else if (msg.type === "recognize") reply({ type: "error", id: msg.id, message: "decode failed" });
  });
  const client = createScheduleOcrClient(() => {}, { probe: installed, spawnWorker: () => w });
  await client.ensureReady();
  await assert.rejects(() => client.recognize(region()), /decode failed/);
});

test("recognize before ready rejects", async () => {
  const client = createScheduleOcrClient(() => {}, { probe: installed, spawnWorker: () => fakeWorker(() => {}) });
  await assert.rejects(() => client.recognize(region()), /not ready/);
});

test("a stale reply id is ignored; the matching id resolves", async () => {
  const words = [{ str: "RB-1", x: 0, y: 0, w: 1, h: 1 }];
  const w = fakeWorker((msg, reply) => {
    if (msg.type === "init") reply({ type: "ready" });
    else if (msg.type === "recognize") {
      reply({ type: "result", id: msg.id + 99, words: [{ str: "STALE", x: 0, y: 0, w: 1, h: 1 }] }); // wrong id
      reply({ type: "result", id: msg.id, words });                                                   // correct id
    }
  });
  const client = createScheduleOcrClient(() => {}, { probe: installed, spawnWorker: () => w });
  await client.ensureReady();
  assert.deepEqual(await client.recognize(region()), words);
});

test("dispose terminates the worker", async () => {
  const w = fakeWorker((msg, reply) => { if (msg.type === "init") reply({ type: "ready" }); });
  const client = createScheduleOcrClient(() => {}, { probe: installed, spawnWorker: () => w });
  await client.ensureReady();
  client.dispose();
  assert.equal(w.terminated, true);
  await assert.rejects(() => client.recognize(region()), /not ready/); // recognize after dispose
});

test("uninstalled is memoized — a no-model origin probes ONCE (F: re-probe 404)", async () => {
  let probes = 0;
  const client = createScheduleOcrClient(() => {}, {
    probe: async () => { probes++; return { ok: false, contentType: "" }; },
    spawnWorker: () => fakeWorker(() => {}),
  });
  assert.equal(await client.ensureReady(), false);
  assert.equal(await client.ensureReady(), false);
  assert.equal(await client.ensureReady(), false);
  assert.equal(probes, 1, "re-probed a known-uninstalled origin");
});

test("two concurrent recognizes both resolve to their own reply (F3: no reassigned handler hang)", async () => {
  const w = fakeWorker((msg, reply) => {
    if (msg.type === "init") reply({ type: "ready" });
    else if (msg.type === "recognize") {
      // reply out of order + after a tick, so a per-call onmessage would drop one
      const delay = msg.id === 1 ? 5 : 0;
      setTimeout(() => reply({ type: "result", id: msg.id, words: [{ str: `w${msg.id}`, x: 0, y: 0, w: 1, h: 1 }] }), delay);
    }
  });
  const client = createScheduleOcrClient(() => {}, { probe: installed, spawnWorker: () => w });
  await client.ensureReady();
  const [a, b] = await Promise.all([client.recognize(region()), client.recognize(region())]);
  assert.deepEqual([a[0].str, b[0].str].sort(), ["w1", "w2"]);
});

test("a worker error EVENT (construct/eval failure) fails init instead of hanging (F2)", async () => {
  const { seen, onStatus } = statuses();
  const w = fakeWorker(() => {}); // never replies to init
  const client = createScheduleOcrClient(onStatus, { probe: installed, spawnWorker: () => w });
  const readyP = client.ensureReady();
  await Promise.resolve();
  (w as unknown as { onerror: (e: unknown) => void }).onerror?.({ message: "Failed to construct worker" });
  assert.equal(await readyP, false);
  assert.equal(seen.at(-1)?.phase, "error");
});

test("dispose rejects an in-flight recognize (F4: no orphaned promise)", async () => {
  const w = fakeWorker((msg, reply) => { if (msg.type === "init") reply({ type: "ready" }); /* never replies to recognize */ });
  const client = createScheduleOcrClient(() => {}, { probe: installed, spawnWorker: () => w });
  await client.ensureReady();
  const rec = client.recognize(region());
  client.dispose();
  await assert.rejects(() => rec, /disposed/);
});
