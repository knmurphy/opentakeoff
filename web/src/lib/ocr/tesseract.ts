// tesseract.js adapter — the engine the Copy-text marquee reaches for when a
// region has NO text layer (a true scan or a flattened export). BROWSER-only
// module (the scheduleParse/recognizer.ts precedents keep pure seams pure):
// pixels in, positioned OcrWord[] out in image-px @ RENDER_SCALE, mapped by
// raster.ts' crop→image math so downstream never sees crop coordinates.
//
// Same-origin ONLY (the client-only pledge — see stt/recognizer.ts): worker,
// wasm core, and traineddata are staged into /ocr/ by scripts/stage-ocr.mjs
// (the fetch-voice-model.mjs precedent); there is no CDN fallback, and a
// preflight HEAD turns "files missing on this deployment" into an honest
// refusal (OCR_NOT_STAGED) instead of an opaque worker crash. The tesseract.js
// ESM dist is imported lazily so neither it nor its worker rides the initial
// bundle; heavy recognition runs inside tesseract's own worker, not ours.
import { cropBoxToWord } from "./raster";
import type { RenderGeometry } from "./raster";
import type { OcrWord } from "./types";

/** Staged asset root — anchored to the deploy's base (`/ocr` at the root,
 *  correct under a sub-path build too; the PlanNavigator BASE_URL precedent). */
const OCR_BASE = `${import.meta.env.BASE_URL ?? "/"}ocr`;

/** Sentinel thrown when the deployment has no staged OCR files — callers map
 *  it to the honest "this build can't read scans" message. */
export const OCR_NOT_STAGED = "ocr-not-staged";

// Structural types for the lazily-imported ESM bundle's recognize tree (the
// words we want sit under data.blocks[].paragraphs[].lines[].words[]).
interface TessBBox { x0: number; y0: number; x1: number; y1: number }
interface TessWord { text?: string; bbox?: TessBBox; confidence?: number }
interface TessLevel { words?: TessWord[]; lines?: TessLevel[]; paragraphs?: TessLevel[]; blocks?: TessLevel[] }
/** the shape we USE from the created worker (mirrors the d.ts EsmWorker) */
interface TessWorker {
  recognize(image: unknown, options?: unknown, output?: { blocks: boolean }): Promise<{ data: unknown }>;
  setParameters(params: Record<string, unknown>): Promise<unknown>;
  terminate(): Promise<unknown>;
}

let workerP: Promise<TessWorker> | null = null;

async function fetchWorker(): Promise<TessWorker> {
  if (!workerP) {
    workerP = (async () => {
      // Staging check BEFORE the spawn: createWorker's failure when
      // workerPath 404s is an opaque blob/worker error nobody can act on.
      const res = await fetch(`${OCR_BASE}/eng.traineddata.gz`, { method: "HEAD" });
      if (!res.ok) throw new Error(OCR_NOT_STAGED);
      // dynamic on purpose: the only call site that ever loads it, and the
      // engine must stay a lazy chunk — a static import would put tesseract's
      // wasm glue in every visitor's initial bundle (stt/recognizer.ts
      // precedent for the same reason)
      const mod = await import("tesseract.js/dist/tesseract.esm.min.js");
      // the ESM dist is a CJS-interop wrapper: everything hangs off `default`
      const { createWorker } = mod.default ?? mod;
      const w = await createWorker("eng", 1, {
        workerPath: `${OCR_BASE}/worker.min.js`,
        corePath: `${OCR_BASE}/`,   // directory: the worker picks its simd/relaxedsimd core variant
        langPath: `${OCR_BASE}/`,
        // the CSP pins worker scripts to 'self' — a blob: wrapper would be
        // refused, and same-origin files never needed the workaround anyway
        workerBlobURL: false,
      });
      // PSM 6 — "a single uniform block of text": the estimator marqueed the
      // paragraph, so the layout analysis is already done; the auto modes
      // spend their budget hunting page structure that isn't there.
      await w.setParameters({ tessedit_pageseg_mode: "6" });
      return w;
    })().catch((e) => { workerP = null; throw e; });
  }
  return workerP;
}

function wordsOf(data: unknown): TessWord[] {
  const out: TessWord[] = [];
  const walk = (n: TessLevel | undefined) => {
    if (!n) return;
    if (n.words) out.push(...n.words);
    for (const k of ["lines", "paragraphs", "blocks"] as const) n[k]?.forEach(walk);
  };
  walk(data as TessLevel);
  return out;
}

export interface RegionOcr {
  words: OcrWord[];
  /** mean word confidence 0..1, when the engine reported any */
  meanConfidence: number | null;
}

/** Recognize a rasterized region. `source` is the region bitmap exactly as
 *  rendered (the caller's canvas — tesseract encodes it before posting to its
 *  worker). Returns words positioned in image-px @ RENDER_SCALE. */
export async function ocrRegion(source: HTMLCanvasElement, g: RenderGeometry): Promise<RegionOcr> {
  const w = await fetchWorker();
  const { data } = await w.recognize(source, {}, { blocks: true });
  const words: OcrWord[] = [];
  let confSum = 0, confN = 0;
  for (const wd of wordsOf(data)) {
    const str = (wd.text || "").trim();
    if (!str || !wd.bbox) continue;
    const conf = typeof wd.confidence === "number" ? wd.confidence / 100 : undefined;
    words.push(cropBoxToWord(str, wd.bbox, g, conf));
    if (conf != null) { confSum += conf; confN++; }
  }
  return { words, meanConfidence: confN ? confSum / confN : null };
}

/** Drop the worker (frees the wasm heap). The next ocrRegion re-inits. */
export async function disposeOcr(): Promise<void> {
  const p = workerP;
  workerP = null;
  try { (await p)?.terminate(); } catch { /* already gone */ }
}
