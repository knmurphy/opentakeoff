// The canvas-context façade. A plugin never touches canvas internals, React
// state, or the store directly — it gets this `ctx`: read accessors (live
// values), commands routed through the real chokepoints, per-plugin storage,
// and a download helper. The surface is FROZEN and symmetric with the
// descriptor: exactly the ten members enumerated below, no more, no less in v1.
// It grows only by a MINOR context bump.

import { createPluginStorage } from "./storage.ts";
import type { MetaStore, PluginStorage } from "./storage.ts";
import { formatVersion } from "./version.ts";
import type { CtxVersion } from "./version.ts";

/** The current context version. major.minor — MINOR bump is additive. */
export const CANVAS_CONTEXT_VERSION: CtxVersion = Object.freeze({ major: 1, minor: 0 });

/** Read-only shapes/conditions are opaque to the pure core (the host owns their
 *  concrete types); a plugin treats them as records. */
export type Condition = Record<string, unknown>;
export type Shape = Record<string, unknown>;

/** A shape command routed through the canvas's real chokepoint. Opaque here —
 *  the host (slice 2b) validates and applies it via applyShapeCommand. */
export type ShapeCommand = Record<string, unknown>;
export interface DispatchOpts {
  readonly [key: string]: unknown;
}

/** The raw capability bag the host wires behind the façade. Kept internal — a
 *  plugin only ever sees the frozen `CanvasContext`, never this. */
export interface CanvasApi {
  readonly units: string;
  getConditions(): Condition[];
  getShapes(): Shape[];
  getActiveConditionId(): string | null;
  getSelectedShapeId(): string | null;
  getProjectName(): string;
  dispatchShape(cmd: ShapeCommand, opts?: DispatchOpts): void;
  download(filename: string, text: string, mime?: string): void;
}

/** Commands sub-surface. Frozen to exactly `{ dispatchShape }`. */
export interface CanvasCommands {
  dispatchShape(cmd: ShapeCommand, opts?: DispatchOpts): void;
}

/** The frozen v1 canvas context handed to every plugin. EXACTLY these ten
 *  members (`version`, `units`, five getters, `commands`, `storage`,
 *  `download`). */
export interface CanvasContext {
  readonly version: string;
  readonly units: string;
  getConditions(): Condition[];
  getShapes(): Shape[];
  getActiveConditionId(): string | null;
  getSelectedShapeId(): string | null;
  getProjectName(): string;
  readonly commands: CanvasCommands;
  readonly storage: PluginStorage;
  download(filename: string, text: string, mime?: string): void;
}

/** Mint one context per plugin (storage is namespaced by `pluginId`). The host
 *  supplies the live `api` and the device `meta` store; the façade only ever
 *  reads through them, so accessors return live values, not a mount snapshot. */
export function buildCanvasContext(
  api: CanvasApi,
  pluginId: string,
  meta: MetaStore,
): CanvasContext {
  const storage = createPluginStorage(pluginId, meta);
  const commands: CanvasCommands = {
    dispatchShape: (cmd, opts) => api.dispatchShape(cmd, opts),
  };
  return {
    version: formatVersion(CANVAS_CONTEXT_VERSION),
    get units() {
      return api.units;
    },
    getConditions: () => api.getConditions(),
    getShapes: () => api.getShapes(),
    getActiveConditionId: () => api.getActiveConditionId(),
    getSelectedShapeId: () => api.getSelectedShapeId(),
    getProjectName: () => api.getProjectName(),
    commands,
    storage,
    download: (filename, text, mime) => api.download(filename, text, mime),
  };
}
