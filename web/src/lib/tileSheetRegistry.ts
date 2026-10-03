// The tile-render worker's message handler (#86, #508), with every browser
// dependency injected so Node can test it. src/pdfTile.worker.ts is the thin
// shell that wires in pdf.js's getDocument, the OffscreenCanvas render and
// postMessage. This file imports neither pdfjs-dist nor the worker's `?url`
// asset, so the test loads it without a browser.
//
// The protocol is pdfTile.worker.ts's, unchanged:
//   in : { type:"openSheet", sheetKey, pageNum, data: ArrayBuffer }
//        { type:"renderTile", reqId, sheetKey, scale, rect:{x,y,w,h}, dark }
//        { type:"cancel", reqId }
//        { type:"closeSheet", sheetKey }
//   out: { type:"sheetReady", sheetKey } | { type:"sheetError", sheetKey, message }
//        { type:"tile", reqId, sheetKey, bitmap, w, h }
//        { type:"tileError", reqId, sheetKey, message }
//
// What the registry owns:
// - Closing a sheet, or failing to load it, destroys its pdf.js loading task.
//   Each document registers its fonts in the worker's self.fonts, and they
//   stay until the document is destroyed or cleaned up. Before #508 the
//   worker did neither, so every closed sheet's fonts stayed in every pool
//   worker until the pool was disposed.
// - A sheet closes and reopens under the same key (tileCompositor's resetAll),
//   so a load can settle after its entry is gone or replaced. Its handlers
//   act only while their entry is still the one registered for the key.
// - Closing rejects the entry's `ready` through a gate, so a render queued
//   behind a load that destroy() leaves unsettled still finishes.
// - Every render gets exactly one reply, except one cancelled by its reqId,
//   which stays silent as before.

export interface Rect { x: number; y: number; w: number; h: number }

export type TileInMsg =
  | { type: "openSheet"; sheetKey: string; pageNum: number; data: ArrayBuffer }
  | { type: "renderTile"; reqId: number; sheetKey: string; scale: number; rect: Rect; dark: boolean }
  | { type: "cancel"; reqId: number }
  | { type: "closeSheet"; sheetKey: string };

/** The slice of pdf.js's PDFDocumentLoadingTask the registry uses. */
export interface LoadingTask { destroy(): Promise<void> }

/** One render in progress: the shell's page.render plus the bitmap it makes. */
export interface RenderHandle {
  promise: Promise<{ bitmap: unknown; w: number; h: number }>;
  cancel(): void;
}

export interface TileSheetDeps {
  /** Starts loading the document; `page` resolves to its page `pageNum`. */
  openDocument(data: ArrayBuffer, pageNum: number): { task: LoadingTask; page: Promise<unknown> };
  /** May throw synchronously (getViewport, canvas allocation). */
  renderTile(page: unknown, o: { scale: number; rect: Rect; dark: boolean }): RenderHandle;
  post(msg: unknown, transfer?: Transferable[]): void;
}

export interface TileSheetRegistry {
  /** Settles when the message's work is done, and never rejects. Opens,
   *  closes and cancels settle as soon as they're registered or torn down
   *  (a close doesn't wait for destroy()); a render settles when its step on
   *  the sheet's chain has posted its reply, or dropped it. */
  handle(msg: TileInMsg): Promise<void>;
  /** Renders not yet finished. For tests. */
  inflightSize(): number;
}

interface SheetEntry {
  task: LoadingTask;
  ready: Promise<unknown>; // the page, or rejects with SHEET_CLOSED on close
  chain: Promise<void>;    // serializes renders on this sheet's page
  close: () => void;       // rejects the gate
}

interface Inflight {
  sheetKey: string;
  cancelled: boolean;
  closedBySheet: boolean;  // cancelled because its sheet closed, so it still gets a reply
  task?: { cancel: () => void };
}

const SHEET_CLOSED = Symbol("sheet closed");
// tileCompositor stays quiet on a tileError containing "Rendering cancelled".
const CLOSED_MESSAGE = "Rendering cancelled: sheet closed";

const messageOf = (err: unknown) => {
  try { return String((err as { message?: unknown })?.message || err); } catch { return "unknown error"; }
};

// destroy() is fire and forget: a sheet's teardown never waits on it, and
// neither a rejection nor a synchronous throw may escape.
function destroyTask(task: LoadingTask) {
  try { void Promise.resolve(task.destroy()).catch(() => {}); } catch { /* already torn down */ }
}

function closeBitmap(bitmap: unknown) {
  try { (bitmap as { close?: () => void })?.close?.(); } catch { /* already closed */ }
}

export function createTileSheetRegistry(deps: TileSheetDeps): TileSheetRegistry {
  const sheets = new Map<string, SheetEntry>();
  const inflight = new Map<number, Inflight>();

  // Posts run in detached handlers and inside a sheet's render chain, where a
  // throw (a DataCloneError, say) would be an unhandled rejection or would
  // reject the chain and drop every later render on the sheet.
  const safePost = (msg: unknown) => {
    try { deps.post(msg); } catch { /* nothing left to tell */ }
  };

  function openSheet(sheetKey: string, pageNum: number, data: ArrayBuffer) {
    if (sheets.has(sheetKey)) return; // idempotent: same file, already opening or open
    let opened: { task: LoadingTask; page: Promise<unknown> };
    try {
      opened = deps.openDocument(data, pageNum);
    } catch (err) {
      // Nothing is registered, so a later open tries again.
      safePost({ type: "sheetError", sheetKey, message: messageOf(err) });
      return;
    }
    let close!: () => void;
    const gate = new Promise<never>((_, reject) => { close = () => reject(SHEET_CLOSED); });
    // Promise.race already handles the gate's rejection; this only makes that
    // explicit, so the gate can never surface as an unhandled rejection.
    gate.catch(() => {});
    // `page` goes into the race as is: a page that resolved before the close
    // still wins it, and the identity check in the handlers below is what
    // keeps that late success quiet.
    const ready = Promise.race([opened.page, gate]);
    const entry: SheetEntry = { task: opened.task, ready, chain: Promise.resolve(), close };
    sheets.set(sheetKey, entry);
    ready.then(
      () => {
        if (sheets.get(sheetKey) === entry) safePost({ type: "sheetReady", sheetKey });
      },
      (err) => {
        // A closed entry rejects here through the gate; a superseded one may
        // reject late. Neither may touch the key's current entry.
        if (sheets.get(sheetKey) !== entry) return;
        sheets.delete(sheetKey);
        destroyTask(entry.task);
        safePost({ type: "sheetError", sheetKey, message: messageOf(err) });
      },
    );
  }

  function closeSheet(sheetKey: string) {
    const entry = sheets.get(sheetKey);
    if (!entry) return; // unknown or already closed: no second destroy
    // Deleted before anything else, so a reopen in the same turn registers a
    // fresh entry instead of hitting the idempotence check.
    sheets.delete(sheetKey);
    for (const f of inflight.values()) {
      if (f.sheetKey !== sheetKey || f.cancelled) continue; // a reqId cancel already ran
      f.cancelled = true;
      f.closedBySheet = true;
      try { f.task?.cancel(); } catch { /* already done */ }
    }
    entry.close();
    destroyTask(entry.task);
  }

  function cancel(reqId: number) {
    const f = inflight.get(reqId);
    if (f) { f.cancelled = true; try { f.task?.cancel(); } catch { /* already done */ } }
  }

  // The reply for a render that ended cancelled. One cancelled by its reqId
  // stays silent, as before. One cancelled by its sheet's close is answered
  // with CLOSED_MESSAGE. In today's flows tilePool has already dropped those
  // reqIds (the caller cancels them before or in the same turn as the close)
  // and ignores the reply; it keeps a caller that closes without cancelling
  // from leaving a request pending, and on a phone from tripping the
  // pool's 30 s watchdog.
  function finish(reqId: number, f: Inflight) {
    inflight.delete(reqId);
    if (f.closedBySheet) safePost({ type: "tileError", reqId, sheetKey: f.sheetKey, message: CLOSED_MESSAGE });
  }

  function renderTile(reqId: number, sheetKey: string, scale: number, rect: Rect, dark: boolean): Promise<void> {
    const entry = sheets.get(sheetKey);
    if (!entry) {
      safePost({ type: "tileError", reqId, sheetKey, message: "sheet not open" });
      return Promise.resolve();
    }
    const f: Inflight = { sheetKey, cancelled: false, closedBySheet: false };
    inflight.set(reqId, f);
    const step = entry.chain.then(async () => {
      if (f.cancelled) return finish(reqId, f);
      try {
        const page = await entry.ready;
        if (f.cancelled) return finish(reqId, f);
        const handle = deps.renderTile(page, { scale, rect, dark });
        f.task = handle;
        const { bitmap, w, h } = await handle.promise;
        if (f.cancelled) {
          // The cancel landed after the render finished, so the bitmap
          // already exists: free it rather than leave it to GC.
          closeBitmap(bitmap);
          return finish(reqId, f);
        }
        inflight.delete(reqId);
        try {
          deps.post({ type: "tile", reqId, sheetKey, w, h, bitmap }, [bitmap as Transferable]);
        } catch (err) {
          // Not transferred, so it's still ours to close.
          closeBitmap(bitmap);
          safePost({ type: "tileError", reqId, sheetKey, message: messageOf(err) });
        }
      } catch (err) {
        // Silence comes from the flag, not the error's name: a close can make
        // pdf.js reject with a plain Error, and a RenderingCancelledException
        // nobody asked for still gets its tileError.
        if (f.cancelled) return finish(reqId, f);
        inflight.delete(reqId);
        // SHEET_CLOSED can't reach here today (a close flags every render on
        // its key first); the mapping is defensive.
        safePost({ type: "tileError", reqId, sheetKey, message: err === SHEET_CLOSED ? CLOSED_MESSAGE : messageOf(err) });
      }
    });
    entry.chain = step;
    return step;
  }

  function handle(msg: TileInMsg): Promise<void> {
    switch (msg.type) {
      case "openSheet": openSheet(msg.sheetKey, msg.pageNum, msg.data); break;
      case "closeSheet": closeSheet(msg.sheetKey); break;
      case "cancel": cancel(msg.reqId); break;
      case "renderTile": return renderTile(msg.reqId, msg.sheetKey, msg.scale, msg.rect, msg.dark);
    }
    return Promise.resolve();
  }

  return { handle, inflightSize: () => inflight.size };
}
