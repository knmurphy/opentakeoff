import type { MetaStore, PluginStorage } from "./storage.ts";
import type { CtxVersion } from "./version.ts";
/** The current context version. major.minor — MINOR bump is additive. */
export declare const CANVAS_CONTEXT_VERSION: CtxVersion;
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
export declare function buildCanvasContext(api: CanvasApi, pluginId: string, meta: MetaStore): CanvasContext;
