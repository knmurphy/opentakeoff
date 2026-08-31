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
  let initInFlight: Promise<boolean> | null = null;
  let seq = 0;

  async function ensureReady(): Promise<boolean> {
    if (ready) return true;
    if (initInFlight) return initInFlight;
    initInFlight = (async () => {
      try {
        // Same-origin probe: distinguishes uninstalled from broken. SPA-fallback
        // servers answer missing files with 200 + index.html, so a non-HTML
        // content-type is part of the check, not just res.ok (the voice precedent).
        const p = await probe(PROBE_FILE);
        if (!p.ok || p.contentType.includes("text/html")) { onStatus({ phase: "uninstalled" }); return false; }
        onStatus({ phase: "loading" });
        worker ??= spawnWorker();
        const ok = await new Promise<boolean>((resolve) => {
          worker!.onmessage = (e: { data: unknown }) => {
            const m = e.data as { type: string; message?: string };
            if (m.type === "ready") { onStatus({ phase: "ready" }); resolve(true); }
            else if (m.type === "error") { onStatus({ phase: "error", message: m.message ?? "init failed" }); resolve(false); }
          };
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
   *  rgba buffer is TRANSFERRED (zero-copy) — the caller must not reuse it.
   *  Serial: one recognize resolves before the next posts (the import flow). */
  function recognize(region: ScanRegion): Promise<OcrWord[]> {
    return new Promise((resolve, reject) => {
      if (!worker || !ready) return reject(new Error("OCR engine not ready"));
      const id = ++seq;
      worker.onmessage = (e: { data: unknown }) => {
        const m = e.data as { type: string; id?: number; words?: OcrWord[]; message?: string };
        if (m.id !== undefined && m.id !== id) return; // ignore a stale reply
        if (m.type === "result") resolve(m.words ?? []);
        else if (m.type === "error") reject(new Error(m.message ?? "OCR failed"));
      };
      worker.postMessage({ type: "recognize", id, rgba: region.rgba, width: region.width, height: region.height, geometry: region.geometry }, [region.rgba.buffer]);
    });
  }

  function dispose() {
    worker?.postMessage({ type: "dispose" });
    worker?.terminate();
    worker = null;
    ready = false;
  }

  return { ensureReady, recognize, dispose };
}
