// Type surface for the lazily-imported tesseract.js browser ESM bundle. The
// package's "main" points at its Node source (conditional requires the bundler
// shouldn't follow), so lib/ocr/tesseract.ts imports the prebuilt ESM dist
// subpath instead — which ships no declarations and is a CJS-interop wrapper
// (the real API hangs off its `default`). These are the only members used;
// recognition output is narrowed structurally in the adapter.
declare module "tesseract.js/dist/tesseract.esm.min.js" {
  export interface EsmWorker {
    recognize(
      image: unknown,
      options?: unknown,
      output?: { blocks: boolean },
    ): Promise<{ data: unknown }>;
    setParameters(params: Record<string, unknown>): Promise<unknown>;
    terminate(): Promise<unknown>;
  }
  export interface EsmCreateWorker {
    createWorker(
      langs?: string,
      oem?: number,
      options?: {
        workerPath?: string;
        corePath?: string;
        langPath?: string;
        workerBlobURL?: boolean;
      },
    ): Promise<EsmWorker>;
  }
  const api: EsmCreateWorker;
  export default api;
}
