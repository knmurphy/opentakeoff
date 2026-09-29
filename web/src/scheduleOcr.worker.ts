// Schedule-OCR worker (docs/SCHEDULE-OCR.md step 6) — runs PaddleOCR (PP-OCRv5
// English mobile, the Experiment-3 ceiling) OFF the main thread so the canvas
// stays smooth while a scanned schedule is read. Mirrors stt.worker.ts: heavy
// work (model compile via init, detection+recognition via recognize) happens
// here; the main thread only posts messages. The recognized cells are mapped —
// with the SAME pure crop-box→image-px map the Node benchmark uses
// (src/lib/ocr/raster.ts) — into the OcrWord[] the vector parser already eats,
// so a scan and a vector sheet feed the one parseSchedule.
//
// Client-only pledge: models are served SAME-ORIGIN from /models/paddle-ocr/
// (staged by scripts/stage-schedule-ocr-model.mjs); the running app never talks
// to a model CDN. onnxruntime-web is pinned to single-thread WASM — OpenTakeoff
// ships no COOP/COEP, so SharedArrayBuffer (multi-thread) is unavailable; WebGPU
// is used when the browser offers it (it needs no cross-origin isolation).
//
// Protocol:
//   in : { type: "init", modelBase }
//        { type: "recognize", id, rgba: Uint8ClampedArray, width, height, geometry }
//        { type: "dispose" }
//   out: { type: "ready" }
//        { type: "result", id, words } | { type: "error", id?, message }
//        (an init error carries no id.)
import { cropBoxToWord, type RenderGeometry } from "./lib/ocr/raster.ts";
import type { OcrWord } from "./lib/ocr/types.ts";

type InMsg =
  | { type: "init"; modelBase: string }
  | { type: "recognize"; id: number; rgba: Uint8ClampedArray; width: number; height: number; geometry: RenderGeometry }
  | { type: "dispose" };

// The PaddleOcrService instance, created lazily on init (its onnxruntime-web +
// opencv-wasm compile is the expensive step, done once).
let service: { recognize: (c: unknown, o: unknown) => Promise<unknown>; destroy: () => Promise<void> } | null = null;

async function init(modelBase: string): Promise<void> {
  if (service) return;
  const ort = await import("onnxruntime-web");
  // Pin the ORT wasm runtime to SAME-ORIGIN bundled assets (`?url` — served in
  // dev, hashed into dist/assets in build), exactly as the STT adapter does
  // (src/lib/stt/transformersJs.ts): without this ORT defaults to a CDN, which
  // the client-only pledge + the production CSP both forbid. The jsep build
  // carries WebGPU; ORT falls back to single-thread WASM where it's absent.
  const [mjs, wasm] = await Promise.all([
    import("onnxruntime-web/ort-wasm-simd-threaded.jsep.mjs?url"),
    import("onnxruntime-web/ort-wasm-simd-threaded.jsep.wasm?url"),
  ]);
  ort.env.wasm.wasmPaths = { mjs: mjs.default, wasm: wasm.default };
  // Single-thread WASM: no COOP/COEP ⇒ no SharedArrayBuffer ⇒ threads can't
  // engage anyway (WebGPU, when present, needs none).
  ort.env.wasm.numThreads = 1;
  const { PaddleOcrService } = await import("ppu-paddle-ocr/web");
  const svc = new PaddleOcrService({
    model: {
      detection: `${modelBase}/det.ort`,
      recognition: `${modelBase}/rec.ort`,
      charactersDictionary: `${modelBase}/dict.txt`,
    },
  }) as unknown as NonNullable<typeof service>;
  // Assign ONLY after initialize() resolves — a failed init (wasm compile, model
  // 404, EP probe) must not leave the idempotence guard (`if (service) return`)
  // pointing at a half-built engine that a retry would then treat as ready
  // (adversarial review F1).
  await (svc as unknown as { initialize: () => Promise<void> }).initialize();
  service = svc;
}

// One recognized region → OcrWord[]. Builds an OffscreenCanvas from the raw RGBA
// (PaddleOCR wants a getContext-able surface), runs the pipeline, and maps each
// line's cell boxes (crop px, top-left origin) into image-px words via the shared
// geometry — identical to scripts/lib/paddleEngine.mjs.
async function recognize(rgba: Uint8ClampedArray, width: number, height: number, geometry: RenderGeometry): Promise<OcrWord[]> {
  if (!service) throw new Error("engine not initialized");
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("no 2d context in worker");
  // Copy the transferred RGBA into a canvas-owned ImageData (avoids the
  // ArrayBuffer-vs-SharedArrayBuffer typing on the ImageData constructor).
  const imgData = ctx.createImageData(width, height);
  imgData.data.set(rgba);
  ctx.putImageData(imgData, 0, 0);
  const res = (await service.recognize(canvas, { flatten: false })) as { lines?: { text?: string; box?: { x: number; y: number; width: number; height: number }; confidence?: number }[][] };
  const words: OcrWord[] = [];
  for (const line of res?.lines ?? []) {
    for (const cell of line ?? []) {
      const str = (cell.text ?? "").trim();
      if (!str || !cell.box) continue;
      const { x, y, width: bw, height: bh } = cell.box;
      words.push(cropBoxToWord(str, { x0: x, y0: y, x1: x + bw, y1: y + bh }, geometry, cell.confidence));
    }
  }
  return words;
}

self.onmessage = async (e: MessageEvent<InMsg>) => {
  const msg = e.data;
  try {
    if (msg.type === "init") {
      await init(msg.modelBase);
      self.postMessage({ type: "ready" });
    } else if (msg.type === "recognize") {
      const words = await recognize(msg.rgba, msg.width, msg.height, msg.geometry);
      self.postMessage({ type: "result", id: msg.id, words });
    } else if (msg.type === "dispose") {
      await service?.destroy();
      service = null;
      self.close();
    }
  } catch (err) {
    const id = msg.type === "recognize" ? msg.id : undefined;
    self.postMessage({ type: "error", id, message: err instanceof Error ? err.message : String(err) });
  }
};
