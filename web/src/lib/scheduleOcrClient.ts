// Main-thread client for the schedule-OCR worker (docs/SCHEDULE-OCR.md step 6).
// Mirrors voiceRecognizerClient.ts: owns the worker lifecycle, exposes a probe +
// a recognize() promise; the canvas never touches the worker directly. Lazy —
// nothing loads until the first scanned-schedule import (the heavy-deps ethos).
//
// "Not installed" is a first-class state, not an error: the model directory is
// gitignored and staged per-deployment by scripts/stage-schedule-ocr-model.mjs.
// A cheap same-origin probe distinguishes "this deployment ships no OCR model"
// (feature absent, fall back to the AI reader) from a real failure (retryable).
import type { OcrWord } from "./ocr/types";
import type { RenderGeometry } from "./ocr/raster";

export type ScanOcrStatus =
  | { phase: "unprobed" }
  | { phase: "uninstalled" }              // no model on this origin — feature absent
  | { phase: "loading" }
  | { phase: "ready" }
  | { phase: "error"; message: string };  // retryable (ensureReady again)

const MODEL_BASE = "/models/paddle-ocr";
const PROBE_FILE = `${MODEL_BASE}/det.ort`;

export interface ScanRegion { rgba: Uint8ClampedArray; width: number; height: number; geometry: RenderGeometry }

// A minimal worker surface — the real Worker satisfies it; a test injects a fake.
export interface WorkerLike {
  postMessage(msg: unknown, transfer?: Transferable[]): void;
  onmessage: ((e: { data: unknown }) => void) | null;
  onerror: ((e: unknown) => void) | null;
  terminate(): void;
}
// Injectable seams so the state machine (probe → init → recognize → dispose) is
// unit-testable without a real Worker or server. Production uses the defaults.
export interface ScanOcrDeps {
  spawnWorker?: () => WorkerLike;
  probe?: (url: string) => Promise<{ ok: boolean; contentType: string }>;
}

const defaultProbe = async (url: string) => {
  const res = await fetch(url, { method: "HEAD" });
  return { ok: res.ok, contentType: res.headers.get("content-type") ?? "" };
};
const defaultSpawn = (): WorkerLike =>
  new Worker(new URL("../scheduleOcr.worker.ts", import.meta.url), { type: "module" }) as unknown as WorkerLike;

export function createScheduleOcrClient(onStatus: (s: ScanOcrStatus) => void = () => {}, deps: ScanOcrDeps = {}) {
  const probe = deps.probe ?? defaultProbe;
  const spawnWorker = deps.spawnWorker ?? defaultSpawn;
  let worker: WorkerLike | null = null;
  let ready = false;
  let uninstalled = false;                 // terminal: no model on this origin — never re-probe
  let initInFlight: Promise<boolean> | null = null;
  let seq = 0;
  // One persistent message router. `init` awaits `pending.get(0)`; each recognize
  // awaits `pending.get(id)`. A reassigned-per-call onmessage would drop a slow
  // reply when a second call started (adversarial review F3) — the Map + a single
  // handler make correlation robust and let dispose reject everything cleanly.
  const pending = new Map<number, { resolve: (w: OcrWord[]) => void; reject: (e: Error) => void }>();
  const INIT_ID = 0;

  function attach(w: WorkerLike) {
    w.onmessage = (e: { data: unknown }) => {
      const m = e.data as { type: string; id?: number; words?: OcrWord[]; message?: string };
      if (m.type === "ready") { pending.get(INIT_ID)?.resolve([]); pending.delete(INIT_ID); return; }
      // result/error carry the recognize id; an init error has none → route to INIT.
      const id = m.id ?? INIT_ID;
      const p = pending.get(id);
      if (!p) return;                        // stale/unknown id — ignore
      pending.delete(id);
      if (m.type === "result") p.resolve(m.words ?? []);
      else if (m.type === "error") p.reject(new Error(m.message ?? "OCR failed"));
    };
    // A Worker that fails to construct or throws during module eval fires an ERROR
    // EVENT, never a message — without this the init promise (and any recognize)
    // would hang forever and wedge the OCR path (adversarial review F2). Fail them.
    w.onerror = (e: unknown) => {
      const message = (e as { message?: string })?.message ?? "worker error";
      rejectAll(new Error(message));
      // Discard the crashed worker so the NEXT ensureReady() respawns a fresh one
      // — a dead worker that fires no further message/error would otherwise hang a
      // retry (adversarial review, both reviewers' residual).
      try { w.terminate(); } catch { /* already gone */ }
      if (worker === w) worker = null;
    };
  }

  function rejectAll(err: Error) {
    for (const [, p] of pending) p.reject(err);
    pending.clear();
    ready = false;
  }

  async function ensureReady(): Promise<boolean> {
    if (ready) return true;
    if (uninstalled) return false;           // memoized — a no-model origin probes ONCE
    if (initInFlight) return initInFlight;
    initInFlight = (async () => {
      try {
        // Same-origin probe: distinguishes uninstalled from broken. SPA-fallback
        // servers answer missing files with 200 + index.html, so a non-HTML
        // content-type is part of the check, not just res.ok (the voice precedent).
        const p = await probe(PROBE_FILE);
        if (!p.ok || p.contentType.includes("text/html")) { uninstalled = true; onStatus({ phase: "uninstalled" }); return false; }
        onStatus({ phase: "loading" });
        if (!worker) { worker = spawnWorker(); attach(worker); }
        const ok = await new Promise<boolean>((resolve) => {
          pending.set(INIT_ID, {
            resolve: () => { onStatus({ phase: "ready" }); resolve(true); },
            reject: (e) => { onStatus({ phase: "error", message: e.message }); resolve(false); },
          });
          worker!.postMessage({ type: "init", modelBase: MODEL_BASE });
        });
        ready = ok;
        return ok;
      } catch (err) {
        onStatus({ phase: "error", message: err instanceof Error ? err.message : String(err) });
        return false;
      } finally {
        initInFlight = null;
      }
    })();
    return initInFlight;
  }

  /** Rasterized region → recognized words (image-px, the parser's space). The
   *  rgba buffer is TRANSFERRED (zero-copy) — the caller must not reuse it. */
  function recognize(region: ScanRegion): Promise<OcrWord[]> {
    return new Promise((resolve, reject) => {
      if (!worker || !ready) return reject(new Error("OCR engine not ready"));
      const id = ++seq;
      pending.set(id, { resolve, reject });
      worker.postMessage({ type: "recognize", id, rgba: region.rgba, width: region.width, height: region.height, geometry: region.geometry }, [region.rgba.buffer]);
    });
  }

  function dispose() {
    worker?.postMessage({ type: "dispose" });
    worker?.terminate();
    worker = null;
    // Settle anything still awaiting so a caller's finally runs (no leaked busy flag).
    rejectAll(new Error("OCR client disposed"));
  }

  return { ensureReady, recognize, dispose };
}
