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

// Wrap the plugin-invoked ACTION surface (the synchronous commands a plugin
// fires from its OWN event handlers — `dispatchShape`, `download`) so a throw is
// contained, logged, and surfaced to the user via `onError` instead of escaping
// as an uncaught error with no signal. This is the overlay-path counterpart to
// the export menu's dispatch-time try/catch (exportItems.js): a React error
// boundary can't catch an event-handler throw, so the guard has to live at the
// capability seam. Read accessors are NOT wrapped (a live read can't meaningfully
// fail here) and neither is `storage` (it's promise-based — a plugin handles its
// own rejection). Contain-log-surface, never a silent swallow.
function guardActions(api, pluginId, onError) {
  const guard = (name, fn) => (...args) => {
    try {
      return fn(...args);
    } catch (err) {
      console.error(`[plugins] "${pluginId}" ${name} threw:`, err);
      onError(pluginId, name, err);
    }
  };
  return {
    ...api,
    dispatchShape: guard("dispatchShape", (cmd, opts) => api.dispatchShape(cmd, opts)),
    download: guard("download", (filename, text, mime) => api.download(filename, text, mime)),
  };
}

// Mint a per-plugin ctx from the live canvas `api` bag. `api` is rebuilt each
// canvas render (its accessors close over current state), so callers must call
// this with the CURRENT api on each render to keep reads live — never cache the
// minted ctx across renders. Pass `onError` to surface action-time faults (the
// overlay host does; the export menu omits it because its own onSelect wrapper
// already contains + surfaces, so double-guarding would be redundant).
export function mintPluginCtx(api, pluginId, onError) {
  const wired = onError ? guardActions(api, pluginId, onError) : api;
  return buildCanvasContext(wired, pluginId, META_STORE);
}
