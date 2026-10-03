// The tile worker's sheet registry (#508), driven with fakes through handle()
// alone, with the same messages tilePool.ts sends. The real pdf.js document
// and OffscreenCanvas render live in pdfTile.worker.ts; here we pin what the
// registry owns: a closed sheet's loading task is destroyed, a load that
// settles after its sheet closed (or was reopened under the same key) is
// ignored, renders on a closed sheet finish with one reply, and a bitmap the
// worker can't hand over is closed.
//
// Opens, closes and cancels are driven with flush(); only render promises are
// awaited or raced, since handle() resolves a render when its chain step is done.
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { createTileSheetRegistry, type Rect, type TileSheetDeps } from "../src/lib/tileSheetRegistry.ts";

// One listener for the whole file: a destroy() or gate rejection nobody
// handles must fail the test that caused it.
let unhandled = 0;
process.on("unhandledRejection", () => { unhandled++; });
beforeEach(() => { unhandled = 0; });
afterEach(async () => {
  await flush();
  assert.equal(unhandled, 0, "no unhandled rejections");
});

/** One macrotask turn: every pending promise job has run by then. */
const flush = () => new Promise<void>((r) => setImmediate(r));

/** True if `p` settles before a flush() does. */
const settlesBeforeFlush = (p: Promise<unknown>) =>
  Promise.race([p.then(() => true, () => true), flush().then(() => false)]);

interface Deferred<T> { promise: Promise<T>; resolve: (v: T) => void; reject: (e: unknown) => void }
function deferred<T>(): Deferred<T> {
  let resolve!: (v: T) => void, reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

interface FakeBitmap { closeCalls: number; close(): void }
interface Opened { page: Deferred<unknown>; pageValue: object; destroyCalls: number }
interface Rendered {
  page: unknown;
  ctl: Deferred<{ bitmap: unknown; w: number; h: number }>;
  cancelCalls: number;
  bitmap: FakeBitmap;
  /** Resolves the render with its bitmap; a cancel after this is a no-op, as in pdf.js. */
  finish(): void;
}
type Posted = { type: string; sheetKey?: string; reqId?: number; message?: string };

function harness(opts: {
  destroy?: "resolve" | "reject" | "never" | "throw";
  openThrowsOnce?: boolean;
  renderThrowsOnce?: boolean;
  cancelThrows?: boolean;
  /** What an in-progress render rejects with when cancelled. */
  cancelError?: unknown;
  tilePostThrowsOnce?: boolean;
} = {}) {
  const posts: Posted[] = [];
  const opened: Opened[] = [];
  const renders: Rendered[] = [];
  let openCalls = 0;
  let openThrown = false, renderThrown = false, tilePostThrown = false;
  const deps: TileSheetDeps = {
    openDocument() {
      openCalls++;
      if (opts.openThrowsOnce && !openThrown) { openThrown = true; throw new Error("getDocument threw"); }
      // `page` is the deferred's own promise, not one derived through .then:
      // T3b needs a resolved page to win Promise.race against the close gate
      // in the same turn, and an extra .then would hand the race to the gate.
      const rec: Opened = { page: deferred<unknown>(), pageValue: { page: opened.length }, destroyCalls: 0 };
      opened.push(rec);
      const task = {
        destroy(): Promise<void> {
          rec.destroyCalls++;
          switch (opts.destroy ?? "resolve") {
            case "reject": return Promise.reject(new Error("destroy failed"));
            case "never": return new Promise<void>(() => {});
            case "throw": throw new Error("destroy threw");
            default: return Promise.resolve();
          }
        },
      };
      return { task, page: rec.page.promise };
    },
    renderTile(page, o) {
      if (opts.renderThrowsOnce && !renderThrown) { renderThrown = true; throw new Error("getViewport threw"); }
      const ctl = deferred<{ bitmap: unknown; w: number; h: number }>();
      let settled = false;
      const bitmap: FakeBitmap = { closeCalls: 0, close() { this.closeCalls++; } };
      const rec: Rendered = {
        page, ctl, cancelCalls: 0, bitmap,
        finish() { settled = true; ctl.resolve({ bitmap, w: o.rect.w, h: o.rect.h }); },
      };
      renders.push(rec);
      return {
        promise: ctl.promise,
        cancel() {
          rec.cancelCalls++;
          if (opts.cancelThrows) throw new Error("cancel threw");
          if (!settled) { settled = true; ctl.reject(opts.cancelError ?? { name: "RenderingCancelledException" }); }
        },
      };
    },
    post(msg) {
      const m = msg as Posted;
      if (opts.tilePostThrowsOnce && m.type === "tile" && !tilePostThrown) {
        tilePostThrown = true;
        throw new Error("DataCloneError");
      }
      posts.push(m);
    },
  };
  const reg = createTileSheetRegistry(deps);
  const RECT: Rect = { x: 0, y: 0, w: 256, h: 256 };
  return {
    reg, posts, opened, renders,
    openCalls: () => openCalls,
    open: (sheetKey = "S") => { void reg.handle({ type: "openSheet", sheetKey, pageNum: 1, data: new ArrayBuffer(8) }); },
    close: (sheetKey = "S") => { void reg.handle({ type: "closeSheet", sheetKey }); },
    cancel: (reqId: number) => { void reg.handle({ type: "cancel", reqId }); },
    render: (reqId: number, sheetKey = "S") => reg.handle({ type: "renderTile", reqId, sheetKey, scale: 1, rect: RECT, dark: false }),
    of: (type: string, reqId?: number) => posts.filter((p) => p.type === type && (reqId === undefined || p.reqId === reqId)),
    repliesTo: (reqId: number) => posts.filter((p) => p.reqId === reqId),
  };
}

const CLOSED = "Rendering cancelled: sheet closed";

// ── T1–T2: the loading task is destroyed ─────────────────────────────────────

test("T1: closing an open sheet destroys its document once; a second close is a no-op", async () => {
  const h = harness();
  h.open();
  h.opened[0].page.resolve(h.opened[0].pageValue);
  await flush();
  assert.equal(h.of("sheetReady").length, 1);
  const before = h.posts.length;
  h.close();
  await flush();
  assert.equal(h.opened[0].destroyCalls, 1, "destroy called once");
  assert.equal(h.posts.length, before, "nothing posted after the close");
  h.close();
  await flush();
  assert.equal(h.opened[0].destroyCalls, 1, "second close doesn't destroy again");
  assert.equal(h.reg.inflightSize(), 0);
});

test("T1 (closed mid-load): no reply for the abandoned load, destroy called once", async () => {
  const h = harness();
  h.open();
  await flush();
  h.close();
  await flush();
  h.opened[0].page.resolve(h.opened[0].pageValue);
  await flush();
  assert.equal(h.posts.length, 0, "zero posts");
  assert.equal(h.opened[0].destroyCalls, 1);
  assert.equal(h.reg.inflightSize(), 0);
});

test("T2: a failed load is destroyed and reported once; the sheet is then not open", async () => {
  const h = harness();
  h.open();
  h.opened[0].page.reject(new Error("Invalid PDF structure."));
  await flush();
  assert.equal(h.opened[0].destroyCalls, 1, "destroy called");
  assert.deepEqual(h.of("sheetError").map((p) => p.message), ["Invalid PDF structure."]);
  await h.render(1);
  assert.deepEqual(h.of("tileError", 1).map((p) => p.message), ["sheet not open"]);
  assert.equal(h.reg.inflightSize(), 0);
});

// ── T3–T4: a superseded load never speaks for the reopened sheet ─────────────

for (const flushed of [false, true]) {
  test(`T3a: close and reopen during the load (${flushed ? "flushed" : "same turn"}); the old load's success is ignored`, async () => {
    const h = harness({ destroy: "never" });
    h.open();
    if (flushed) await flush();
    h.close();
    if (flushed) await flush();
    h.open();
    await flush();
    assert.equal(h.opened.length, 2, "reopen started a new load");
    h.opened[0].page.resolve(h.opened[0].pageValue);
    await flush();
    assert.equal(h.of("sheetReady").length, 0, "no sheetReady from the old load");
    assert.equal(h.of("sheetError").length, 0);
    h.opened[1].page.resolve(h.opened[1].pageValue);
    await flush();
    assert.equal(h.of("sheetReady").length, 1, "one sheetReady, from the new load");
    const r = h.render(1);
    await flush();
    h.renders[0].finish();
    await r;
    assert.equal(h.of("tile", 1).length, 1);
    assert.equal(h.renders[0].page, h.opened[1].pageValue, "rendered the new load's page");
    assert.equal(h.reg.inflightSize(), 0);
  });
}

test("T3b: the old page resolves, then close and reopen in the same turn; its success handler is ignored", async () => {
  const h = harness();
  h.open();
  await flush();
  h.opened[0].page.resolve(h.opened[0].pageValue);
  h.close();
  h.open();
  await flush();
  assert.equal(h.of("sheetReady").length, 0, "no sheetReady before the new load resolves");
  h.opened[1].page.resolve(h.opened[1].pageValue);
  await flush();
  assert.equal(h.of("sheetReady").length, 1);
  assert.equal(h.reg.inflightSize(), 0);
});

test("T3c: the new load resolves first and the old one late; still one sheetReady", async () => {
  const h = harness();
  h.open();
  h.close();
  h.open();
  h.opened[1].page.resolve(h.opened[1].pageValue);
  await flush();
  assert.equal(h.of("sheetReady").length, 1);
  h.opened[0].page.resolve(h.opened[0].pageValue);
  await flush();
  assert.equal(h.of("sheetReady").length, 1, "the late old load adds nothing");
  assert.equal(h.reg.inflightSize(), 0);
});

for (const order of ["old rejects first", "new resolves first"] as const) {
  test(`T4: close and reopen during the load; the old load fails (${order})`, async () => {
    const h = harness({ destroy: "never" });
    h.open();
    h.close();
    h.open();
    await flush();
    if (order === "old rejects first") {
      h.opened[0].page.reject(new Error("Loading aborted"));
      await flush();
      h.opened[1].page.resolve(h.opened[1].pageValue);
    } else {
      h.opened[1].page.resolve(h.opened[1].pageValue);
      await flush();
      h.opened[0].page.reject(new Error("Loading aborted"));
    }
    await flush();
    assert.equal(h.of("sheetError").length, 0, "no sheetError from the old load");
    assert.equal(h.of("sheetReady").length, 1, "one sheetReady, from the new load");
    const r = h.render(1);
    await flush();
    h.renders[0].finish();
    await r;
    assert.equal(h.of("tile", 1).length, 1, "the new entry is intact");
    assert.equal(h.reg.inflightSize(), 0);
  });
}

// ── T5–T8: renders when their sheet closes ───────────────────────────────────

test("T5: a render queued on a load that never settles finishes when the sheet closes", { timeout: 2000 }, async () => {
  const h = harness({ destroy: "never" });
  h.open();
  const queued = h.render(1);
  await flush();
  h.close();
  h.open();
  assert.equal(await settlesBeforeFlush(queued), true, "the queued render settles");
  assert.equal(h.renders.length, 0, "the render dep was never called for it");
  assert.deepEqual(h.repliesTo(1).map((p) => [p.type, p.message]), [["tileError", CLOSED]]);
  h.opened[1].page.resolve(h.opened[1].pageValue);
  await flush();
  assert.equal(h.of("sheetReady").length, 1, "the new open still works");
  const r = h.render(2);
  await flush();
  h.renders[0].finish();
  await r;
  assert.equal(h.of("tile", 2).length, 1);
  assert.equal(h.reg.inflightSize(), 0);
});

for (const cancelError of [{ name: "RenderingCancelledException" }, new Error("Page was destroyed.")]) {
  const label = cancelError instanceof Error ? "plain Error" : "RenderingCancelledException";
  test(`T6: closing cancels the render in progress, which gets one "sheet closed" reply (${label})`, async () => {
    const h = harness({ cancelError });
    h.open();
    h.opened[0].page.resolve(h.opened[0].pageValue);
    await flush();
    const r = h.render(1);
    await flush();
    assert.equal(h.renders.length, 1, "render in progress");
    h.close();
    await flush();
    assert.equal(h.renders[0].cancelCalls, 1, "its handle cancelled once");
    await r;
    assert.deepEqual(h.repliesTo(1).map((p) => [p.type, p.message]), [["tileError", CLOSED]]);
    assert.equal(h.reg.inflightSize(), 0);
  });
}

test("T6b: a render cancelled by reqId isn't cancelled again by the close, and stays silent", async () => {
  const h = harness();
  h.open();
  h.opened[0].page.resolve(h.opened[0].pageValue);
  await flush();
  const r = h.render(1);
  await flush();
  // Same turn, as tileCompositor's resetAll sends them: the render is still
  // in flight when the close arrives.
  h.cancel(1);
  h.close();
  await flush();
  await r;
  assert.equal(h.renders[0].cancelCalls, 1);
  assert.equal(h.repliesTo(1).length, 0, "no reply");
  assert.equal(h.reg.inflightSize(), 0);
});

test("T7: a cancel landing in the same turn the render finishes closes the bitmap", async () => {
  const h = harness();
  h.open();
  h.opened[0].page.resolve(h.opened[0].pageValue);
  await flush();
  const r = h.render(1);
  await flush();
  h.renders[0].finish();
  h.cancel(1);
  await r;
  assert.equal(h.renders[0].bitmap.closeCalls, 1, "bitmap closed");
  assert.equal(h.repliesTo(1).length, 0, "no tile, no reply");
  assert.equal(h.reg.inflightSize(), 0);
});

test("T8: closing one sheet leaves another sheet's render alone", async () => {
  const h = harness();
  h.open("A");
  h.open("B");
  h.opened[0].page.resolve(h.opened[0].pageValue);
  h.opened[1].page.resolve(h.opened[1].pageValue);
  await flush();
  const r = h.render(1, "B");
  await flush();
  h.close("A");
  await flush();
  assert.equal(h.renders[0].cancelCalls, 0);
  h.renders[0].finish();
  await r;
  assert.equal(h.of("tile", 1).length, 1);
  assert.equal(h.reg.inflightSize(), 0);
});

// ── T9–T16: failures ─────────────────────────────────────────────────────────

test("T9: openDocument throwing reports sheetError and registers nothing, so a reopen tries again", async () => {
  const h = harness({ openThrowsOnce: true });
  h.open();
  await flush();
  assert.deepEqual(h.of("sheetError").map((p) => p.message), ["getDocument threw"]);
  h.open();
  await flush();
  assert.equal(h.openCalls(), 2, "the reopen called openDocument again");
  h.opened[0].page.resolve(h.opened[0].pageValue);
  await flush();
  assert.equal(h.of("sheetReady").length, 1);
  assert.equal(h.reg.inflightSize(), 0);
});

test("T10: a tile post that throws closes the bitmap, replies tileError, and doesn't block the sheet", async () => {
  const h = harness({ tilePostThrowsOnce: true });
  h.open();
  h.opened[0].page.resolve(h.opened[0].pageValue);
  await flush();
  const r1 = h.render(1);
  await flush();
  h.renders[0].finish();
  await r1;
  assert.equal(h.renders[0].bitmap.closeCalls, 1, "bitmap closed");
  assert.deepEqual(h.repliesTo(1).map((p) => [p.type, p.message]), [["tileError", "DataCloneError"]]);
  const r2 = h.render(2);
  await flush();
  h.renders[1].finish();
  await r2;
  assert.equal(h.of("tile", 2).length, 1, "the next render still posts");
  assert.equal(h.reg.inflightSize(), 0);
});

test("T11: a duplicate open for an open sheet doesn't load it again", async () => {
  const h = harness();
  h.open();
  h.open();
  await flush();
  assert.equal(h.openCalls(), 1);
  assert.equal(h.reg.inflightSize(), 0);
});

test("T12: the render dep throwing replies tileError and doesn't block the sheet", async () => {
  const h = harness({ renderThrowsOnce: true });
  h.open();
  h.opened[0].page.resolve(h.opened[0].pageValue);
  await flush();
  await h.render(1);
  assert.deepEqual(h.repliesTo(1).map((p) => [p.type, p.message]), [["tileError", "getViewport threw"]]);
  assert.equal(h.reg.inflightSize(), 0, "in-flight entry cleared");
  const r2 = h.render(2);
  await flush();
  h.renders[0].finish();
  await r2;
  assert.equal(h.of("tile", 2).length, 1);
  assert.equal(h.reg.inflightSize(), 0);
});

test("T13: destroy() rejecting is caught; close and reopen still work", async () => {
  const h = harness({ destroy: "reject" });
  h.open();
  h.opened[0].page.resolve(h.opened[0].pageValue);
  await flush();
  h.close();
  await flush();
  h.open();
  h.opened[1].page.resolve(h.opened[1].pageValue);
  await flush();
  assert.equal(h.of("sheetReady").length, 2, "one per open");
  const r = h.render(1);
  await flush();
  h.renders[0].finish();
  await r;
  assert.equal(h.of("tile", 1).length, 1);
  assert.equal(h.reg.inflightSize(), 0);
});

test("T13 (destroy throws synchronously): close, a failed load and reopen still behave", async () => {
  const h = harness({ destroy: "throw" });
  h.open();
  h.opened[0].page.resolve(h.opened[0].pageValue);
  await flush();
  h.close();
  await flush();
  h.open();
  h.opened[1].page.reject(new Error("Invalid PDF structure."));
  await flush();
  assert.deepEqual(h.of("sheetError").map((p) => p.message), ["Invalid PDF structure."], "failure path still posts sheetError");
  h.open();
  h.opened[2].page.resolve(h.opened[2].pageValue);
  await flush();
  assert.equal(h.of("sheetReady").length, 2);
  assert.equal(h.reg.inflightSize(), 0);
});

test("T14: a render's cancel throwing inside the close doesn't stop the teardown", async () => {
  const h = harness({ cancelThrows: true });
  h.open();
  h.opened[0].page.resolve(h.opened[0].pageValue);
  await flush();
  const r1 = h.render(1);
  const r2 = h.render(2); // queued behind r1 on the sheet's chain
  await flush();
  h.close();
  await flush();
  assert.equal(h.opened[0].destroyCalls, 1, "destroy still called");
  // r1's cancel threw, so its render runs on and finishes late: its bitmap
  // is closed and it gets the one "sheet closed" reply.
  h.renders[0].finish();
  await Promise.all([r1, r2]);
  assert.equal(h.renders[0].bitmap.closeCalls, 1);
  assert.deepEqual(h.repliesTo(1).map((p) => [p.type, p.message]), [["tileError", CLOSED]]);
  assert.deepEqual(h.repliesTo(2).map((p) => [p.type, p.message]), [["tileError", CLOSED]]);
  assert.equal(h.renders.length, 1, "the queued render never reached the render dep");
  assert.equal(h.reg.inflightSize(), 0);
});

test("T15: closeSheet's handle() settles without waiting for destroy()", async () => {
  const h = harness({ destroy: "never" });
  h.open();
  h.opened[0].page.resolve(h.opened[0].pageValue);
  await flush();
  const closing = h.reg.handle({ type: "closeSheet", sheetKey: "S" });
  assert.equal(await settlesBeforeFlush(closing), true, "close settled");
  assert.equal(h.opened[0].destroyCalls, 1, "destroy was called, and is still pending");
  assert.equal(h.reg.inflightSize(), 0);
});

test("T16: a RenderingCancelledException nobody asked for is still answered with a tileError", async () => {
  const h = harness();
  h.open();
  h.opened[0].page.resolve(h.opened[0].pageValue);
  await flush();
  const r = h.render(1);
  await flush();
  h.renders[0].ctl.reject({ name: "RenderingCancelledException" });
  await r;
  assert.equal(h.of("tile", 1).length, 0);
  assert.equal(h.of("tileError", 1).length, 1, "exactly one tileError");
  assert.equal(h.reg.inflightSize(), 0);
});
