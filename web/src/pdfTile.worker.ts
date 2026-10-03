// Tile-render worker (#86) — owns one pdf.js instance PER SHEET PER WORKER,
// renders requested tiles into an OffscreenCanvas, transfers the result back
// as an ImageBitmap (zero-copy). Every open sheet is loaded into EVERY
// worker in the pool (lib/tilePool.ts broadcasts, doesn't hash-pin), and
// tile requests round-robin across the whole pool — so a single sheet gets
// real N-way render parallelism (N = pool size), not just group-mode panels
// splitting across workers.
//
// hush.ts (mcp/) is prior art for "pdf.js is fussy about its environment":
// verbosity:0 here for the same reason (its console noise has no wire
// contract to protect in a Worker, but it's still noise); Promise.withResolvers
// gets the same defensive polyfill pdf.js 4.x needs on any global scope predating
// it (Baseline 2024 — some browsers in the field are still older). Unlike
// mcp/src/pdf.ts, no @napi-rs/canvas shim is needed: OffscreenCanvas + Path2D +
// DOMMatrix + ImageData are all native in a real browser Worker.
//
// GlobalWorkerOptions.workerSrc IS set below, to the same pdf.worker.min.mjs
// the main thread uses — turns out pdf.js 4.x does NOT silently fall back to
// in-context ("fake worker") parsing when it's unset; PDFWorker._initialize
// reads the `workerSrc` getter before any try/catch can catch it, so the
// first getDocument() call in a fresh realm just throws `No
// "GlobalWorkerOptions.workerSrc" specified.` (confirmed live — there's no
// `disableWorker` option on this version's DocumentInitParameters either).
// It doesn't start a nested worker, though: _initialize next reads
// `window.location`, which throws in a worker, so pdf.js falls back to its
// fake worker, which import()s workerSrc and parses on this worker's own
// thread (measured in #508: globalThis.pdfjsWorker is set in every tile
// worker). Importing pdf.worker.min.mjs in a dedicated worker also runs its
// initializeFromPort(self), which adds a message listener here and posts one
// { action: "ready" } message; tilePool reads only `type` and ignores it.
// Parsing on this thread is fine: it's still off the main UI thread, and
// parsing was never the expensive part; painting (this worker's own job) is.
//
// The message handling (sheet lifecycle, render chain, cancel, replies) lives
// in lib/tileSheetRegistry.ts, tested under Node; this file wires in pdf.js,
// the OffscreenCanvas render and postMessage. The protocol is listed there.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
if (typeof (Promise as any).withResolvers !== "function") {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (Promise as any).withResolvers = function withResolvers() {
    let resolve, reject;
    const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
    return { promise, resolve, reject };
  };
}

import * as pdfjsLib from "pdfjs-dist";
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { createTileSheetRegistry, type TileInMsg } from "./lib/tileSheetRegistry.ts";

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

// pdf.js's default DOMCanvasFactory allocates SCRATCH canvases during
// page.render() (pattern tiles, transparency groups, image masks) via
// document.createElement — and there is no `document` in a Worker, so every
// render dies with "Cannot read properties of undefined (reading
// 'createElement')" (confirmed live; the doc OPENS fine, only render crashes).
// getDocument() takes the factory CLASS (constructed internally with
// { ownerDocument, enableHWA }) — this one is OffscreenCanvas all the way down.
class OffscreenCanvasFactory {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  constructor(_opts?: unknown) { /* ownerDocument/enableHWA — irrelevant off-DOM */ }
  create(width: number, height: number) {
    if (width <= 0 || height <= 0) throw new Error("Invalid canvas size");
    const canvas = new OffscreenCanvas(width, height);
    return { canvas, context: canvas.getContext("2d", { willReadFrequently: true }) };
  }
  reset(cc: { canvas: OffscreenCanvas | null }, width: number, height: number) {
    if (!cc.canvas) throw new Error("Canvas is not specified");
    if (width <= 0 || height <= 0) throw new Error("Invalid canvas size");
    cc.canvas.width = width; cc.canvas.height = height;
  }
  destroy(cc: { canvas: OffscreenCanvas | null; context: unknown }) {
    if (!cc.canvas) throw new Error("Canvas is not specified");
    cc.canvas.width = 0; cc.canvas.height = 0;
    cc.canvas = null; cc.context = null;
  }
}

// Same story for the default DOMFilterFactory (SVG filter elements need a
// document). pdf.js's own Node build ships `class NodeFilterFactory extends
// BaseFilterFactory {}` — every method returns "none", filters degrade
// gracefully — so a no-op factory here is exactly the upstream-sanctioned
// behavior for a DOM-less realm, not a hack.
class WorkerFilterFactory {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  constructor(_opts?: unknown) { /* docId/ownerDocument — unused */ }
  addFilter() { return "none"; }
  addHCMFilter() { return "none"; }
  addAlphaFilter() { return "none"; }
  addLuminosityFilter() { return "none"; }
  addHighlightHCMFilter() { return "none"; }
  destroy() { /* nothing cached */ }
}

// tsconfig's `lib` is DOM-only (no "webworker" — TS disallows DOM + webworker
// together in one program, and this repo's app code needs DOM). That makes
// `self` type as `Window`, whose postMessage(message, targetOrigin, transfer)
// overload doesn't match a transfer-list call — this worker is the first in
// the repo to transfer (stt.worker.ts never does). One narrow cast, isolated
// here, instead of fighting the project-wide lib config.
const post = self.postMessage as (message: unknown, transfer?: Transferable[]) => void;

function invertOffscreen(canvas: OffscreenCanvas) {
  const ctx = canvas.getContext("2d") as OffscreenCanvasRenderingContext2D;
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalCompositeOperation = "difference";
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.restore();
}

const registry = createTileSheetRegistry({
  openDocument(data, pageNum) {
    // workerSrc is set above (see header); the parse runs on this thread.
    // CanvasFactory/FilterFactory MUST be overridden here: the DOM defaults
    // dereference `document` mid-render (see class comments above).
    const task = pdfjsLib.getDocument({
      data,
      verbosity: 0,
      CanvasFactory: OffscreenCanvasFactory,
      FilterFactory: WorkerFilterFactory,
      // FontLoader gates ALL embedded-font binding on `ownerDocument.fonts`
      // (default ownerDocument = globalThis.document = undefined here), so
      // without this every glyph paints as a .notdef tofu box (confirmed
      // live at 102% zoom). Workers have their own FontFaceSet — self.fonts
      // — and OffscreenCanvas text drawing reads from it, so handing pdf.js
      // the worker global as its "document" makes embedded fonts load
      // exactly like they do on the main thread. (FontLoader's DOM-y
      // createElement/styleSheet path is only reached when FontFaceSet is
      // MISSING, so it stays dead here.) Those FontFaces stay in self.fonts
      // until the task is destroyed, which the registry does when the sheet
      // closes or fails to load (#508).
      ownerDocument: self as unknown as Document,
    });
    return { task, page: task.promise.then((doc) => doc.getPage(pageNum)) };
  },
  renderTile(page, { scale, rect, dark }) {
    const canvas = new OffscreenCanvas(Math.max(1, rect.w), Math.max(1, rect.h));
    const ctx = canvas.getContext("2d") as OffscreenCanvasRenderingContext2D;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const viewport = (page as any).getViewport({ scale });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const renderTask = (page as any).render({
      canvasContext: ctx,
      viewport,
      transform: [1, 0, 0, 1, -rect.x, -rect.y],
    });
    return {
      // The registry checks for a cancel after this resolves and closes the
      // bitmap if one landed.
      promise: renderTask.promise.then(() => {
        if (dark) invertOffscreen(canvas);
        return { bitmap: canvas.transferToImageBitmap(), w: rect.w, h: rect.h };
      }),
      cancel: () => renderTask.cancel(),
    };
  },
  post: (msg, transfer) => post(msg, transfer ?? []),
});

self.onmessage = (e: MessageEvent<TileInMsg>) => { void registry.handle(e.data); };
