// SPIKE (throwaway) — issue #166 feasibility probe. NOT the real contract.
//
// The plugin canvas-context façade. A plugin never touches canvas internals or
// React state directly; it gets this `ctx` — accessors (read live values),
// commands (route through the real chokepoints), namespaced storage, and a
// download helper. Shape mirrors the proven agentTools `ctx` (all functions,
// no raw mutable state, no setters).

import { metaGet, metaPut, metaDelete } from "../store.js";

export const CANVAS_CONTEXT_VERSION = 1;

// Per-plugin key/value storage. NOTE (spike finding): metaGet/metaPut are
// device-local IndexedDB and Drive-free BY DESIGN (see store.js) — this does
// NOT sync with the project in cloud mode. `scope` is surfaced so a plugin can
// make an honest choice; project-scoped SYNCED plugin data is a separate,
// unbuilt seam (would have to ride the annotations payload).
export function createPluginStorage(pluginId) {
  const k = (key) => `plugin:${pluginId}:${key}`;
  return {
    scope: "device-local",
    get: (key) => metaGet(k(key)),
    set: (key, value) => metaPut(k(key), value),
    remove: (key) => metaDelete(k(key)),
  };
}

function download(filename, text, mime = "text/plain") {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

// `api` is the raw capability bag the canvas exposes (getters + dispatchShape).
// The host mints one ctx per plugin so storage is namespaced per plugin.
export function buildCanvasContext(api, pluginId) {
  return {
    version: CANVAS_CONTEXT_VERSION,
    get units() { return api.units; },
    getConditions: () => api.getConditions(),
    getShapes: () => api.getShapes(),
    getActiveConditionId: () => api.getActiveConditionId(),
    getSelectedShapeId: () => api.getSelectedShapeId(),
    getProjectName: () => api.getProjectName(),
    commands: {
      // Routes through the canvas's real chokepoint (applyShapeCommand +
      // undo/redo recording + provenance) — a plugin can never bypass it.
      dispatchShape: (cmd, opts) => api.dispatchShape(cmd, opts),
    },
    storage: createPluginStorage(pluginId),
    download,
  };
}
