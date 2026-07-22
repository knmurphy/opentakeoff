// Shared host-side plugin wiring — the ONE place the app adapts its concrete
// stores to the frozen #167 façade, so every consumer (the overlay host in
// #168, the export menu in #169) mints ctx the same way. There is exactly one
// `buildCanvasContext` definition (context.ts); this module just supplies the
// device MetaStore adapter and a mint helper so no consumer re-invents either.

import { buildCanvasContext } from "./context.js";
import { metaGet, metaPut, metaDelete } from "../store.js";

// Adapt the app's flat meta helpers to the MetaStore handle buildCanvasContext
// injects into per-plugin storage. Device-scoped; the storage layer owns the
// namespacing so a plugin can't climb into another's keys.
export const META_STORE = {
  get: (key) => metaGet(key),
  put: (key, value) => metaPut(key, value),
  delete: (key) => metaDelete(key),
};

// Mint a per-plugin ctx from the live canvas `api` bag. `api` is rebuilt each
// canvas render (its accessors close over current state), so callers must call
// this with the CURRENT api on each render to keep reads live — never cache the
// minted ctx across renders.
export function mintPluginCtx(api, pluginId) {
  return buildCanvasContext(api, pluginId, META_STORE);
}
