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
 *  correct under a sub-path build too; the PlanNavigator BASE_URL precedent).
 *  A REMOTE base (a CDN) would break the same-origin pledge, so fetchWorker
 *  refuses it outright rather than reading from another origin. */
const OCR_BASE = `${import.meta.env.BASE_URL ?? "/"}ocr`;

/** Sentinel thrown when the deployment has no staged OCR files — callers map
 *  it to the honest "this build can't read scans" message. */
export const OCR_NOT_STAGED = "ocr-not-staged";

/** Sentinel thrown when the files are staged but the engine cannot START
 *  (worker spawn, wasm compile, init) — a deployment/browser condition no
 *  marquee can fix, so callers must not advise "try a tighter box". */
export const OCR_ENGINE_UNAVAILABLE = "ocr-engine-unavailable";

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
      // Staging check BEFORE the spawn: createWorker's failure on a missing
      // file is an opaque blob/worker error nobody can act on. TWO traps the
      // check must survive: (1) it covers every staged artifact, not one —
      // a set with the lang file but no worker would sail a single probe;
      // (2) SPA hosts (this deploy: netlify.toml's `/* → /index.html` 200)
      // answer missing paths with 200 + text/html, so a bare res.ok is
      // spoofed by the site's own fallback — only a non-HTML content-type
      // counts as "present".
      const base = import.meta.env.BASE_URL ?? "/";
      // absolute OR protocol-relative bases read cross-origin — refuse both
      if (/^([a-z][a-z0-9+.-]*:)?\/\//i.test(base)) throw new Error(OCR_NOT_STAGED);
      const probe = async (f: string) => {
        let res: Response;
        try {
          res = await fetch(`${OCR_BASE}/${f}`, { method: "HEAD" });
        } catch {
          // a fetch REJECTION (offline, DNS) is an environment failure, not
          // missing files — it belongs to the engine-unavailable family, not
          // the "tighter box" one the caller's generic catch would say
          throw new Error(OCR_ENGINE_UNAVAILABLE);
        }
        const ct = res.headers.get("content-type") || "";
        if (!res.ok || ct.includes("text/html")) throw new Error(OCR_NOT_STAGED);
      };
      await Promise.all([
        probe("worker.min.js"),
        probe("tesseract-core-relaxedsimd-lstm.wasm.js"),
        probe("tesseract-core-relaxedsimd-lstm.wasm"),
        probe("tesseract-core-simd-lstm.wasm.js"),
        probe("tesseract-core-simd-lstm.wasm"),
        probe("tesseract-core-lstm.wasm.js"),
        probe("tesseract-core-lstm.wasm"),
        probe("eng.traineddata.gz"),
      ]);
      try {
        // dynamic on purpose: the only call site that ever loads it, and the
        // engine must stay a lazy chunk — a static import would put tesseract's
        // wasm glue in every visitor's initial bundle (stt/recognizer.ts
        // precedent for the same reason). A chunk-load failure (stale deploy,
        // 404, network) is an engine-START failure — inside this try on
        // purpose, so it maps to OCR_ENGINE_UNAVAILABLE too.
        const mod = await import("tesseract.js/dist/tesseract.esm.min.js");
        // the ESM dist is a CJS-interop wrapper: everything hangs off `default`
        const { createWorker } = mod.default ?? mod;
        const w = await createWorker("eng", 1, {
          workerPath: `${OCR_BASE}/worker.min.js`,
          corePath: `${OCR_BASE}/`,   // directory: the worker picks its simd/relaxedsimd core variant
          langPath: `${OCR_BASE}/`,
          // the staged files are same-origin, so no blob: wrapper is needed —
          // this keeps the spawn a plain 'self' worker under the CSP
          workerBlobURL: false,
        });
        // PSM 6 — "a single uniform block of text": the estimator marqueed the
        // paragraph, so the layout analysis is already done; the auto modes
        // spend their budget hunting page structure that isn't there.
        await w.setParameters({ tessedit_pageseg_mode: "6" });
        return w;
      } catch (e) {
        // staged but won't start (chunk load, spawn, wasm, init): a condition
        // the marquee cannot fix — say THAT, not "tighter box". The cause
        // stays in the console for field reports.
        console.warn("ocr: engine failed to start", e);
        throw new Error(OCR_ENGINE_UNAVAILABLE);
      }
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
  const raw = wordsOf(data);
  // shape canary: the version is pinned, but a deliberate tesseract major
  // could nest differently — a populated tree that yields ZERO words then
  // reads downstream as an honest "No text recognized", which it isn't.
  // Warn (don't throw: an empty page is still legal) so a field report says
  // "shape changed", not "OCR went blind".
  if (!raw.length) {
    const lvl = data as TessLevel;
    if (lvl?.blocks?.length || lvl?.paragraphs?.length || lvl?.lines?.length) {
      console.warn("ocr: recognizer returned a populated tree but no words were walked — output shape changed?");
    }
  }
  // Confidence floor: tesseract's sparse-ink junk (fragments of wall
  // linework read as "OO", "EM", "LC"…) scores far below real words, and the
  // head-to-head bench measured that dropping words below 0.60 raises sparse
  // region precision ~2.5-3x (0.235→0.667 / 0.571→0.8 / 0.667→1.0 across
  // region×zoom cells) with ZERO recall loss in every cell. Words with no
  // reported confidence are kept — absence of a score is not a low score.
  // (The paddle adapter must NOT copy this floor: its confidence is per-LINE,
  // and filtering on it drops real text — measured 0.846→0.385 recall.)
  const CONF_FLOOR = 0.6;
  const words: OcrWord[] = [];
  let confSum = 0, confN = 0;
  for (const wd of raw) {
    const str = (wd.text || "").trim();
    if (!str || !wd.bbox) continue;
    const conf = typeof wd.confidence === "number" ? wd.confidence / 100 : undefined;
    if (conf != null && conf < CONF_FLOOR) continue;
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
