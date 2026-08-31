// Vite asset-import shims for the strict-checked .ts modules (the canvas .jsx
// side never needed them). `?url` returns the served/emitted asset URL — the
// STT adapter uses it to pin the ORT wasm runtime same-origin (RFC #59).
declare module "*?url" {
  const url: string;
  export default url;
}

// Vite's import.meta.env surface (vite/env), for the same strict .ts modules:
// BASE_URL is the deploy's base — "/" at the root, "/sub/" under a base build.
// The OCR adapter anchors its staged-asset root to it (the PlanNavigator
// precedent), so a sub-path deploy resolves /sub/ocr/ instead of /ocr/.
interface ImportMetaEnv {
  /** deploy base — "/" at the root; optional because tests stub env as {} */
  readonly BASE_URL?: string;
  /** deploy-specific vars (VITE_*) — unknown, not enumerated here */
  readonly [key: string]: unknown;
}
interface ImportMeta {
  readonly env: ImportMetaEnv;
}
