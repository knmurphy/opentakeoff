// Public entry point for the plugin contract core — the semver'd surface a
// feature/community plugin pins to. `npm run emit-types` compiles this module's
// declarations into public-types/ as the published `.d.ts` artifact.
//
// Deliberately NARROW: everything exported here is a public promise, frozen
// until a version bump. It publishes the author-facing shapes (the descriptor,
// the ctx, storage), the author-facing validator, and the composer functions the
// host uses to gate + load plugins. It intentionally does NOT publish:
//   - the keyspace format (`pluginStorageKey`) — core owns the keyspace; freezing
//     it would lock the length-prefix scheme forever for zero author benefit;
//   - host-injection types (`CanvasApi`, `MetaStore`) and `createPluginStorage`
//     — these are how slice 2b WIRES the façade, not what an author writes;
//   - the version arithmetic (`parseVersion`/`satisfies`/…) and internal
//     predicates (`isActivatable`, `DESCRIPTOR_KEYS`) — implementation detail
//     behind the frozen comparison the composer functions already apply.
// The host and tests import those internals from their concrete modules.

// Author-facing descriptor surface.
export { validateDescriptor } from "./descriptor.ts";
export type {
  PluginDescriptor,
  OverlaySlot,
  ExportSlot,
  ValidateResult,
} from "./descriptor.ts";

// Author-facing canvas context surface.
export { buildCanvasContext, CANVAS_CONTEXT_VERSION } from "./context.ts";
export type {
  CanvasContext,
  CanvasCommands,
  Condition,
  Shape,
  ShapeCommand,
  DispatchOpts,
} from "./context.ts";

// Author-facing storage surface (the handle + its scope input; NOT the keyspace
// format or the backing MetaStore).
export type { PluginStorage, StorageScope, StorageOpts } from "./storage.ts";

// Composer functions: the host gates plugins by version then loads them.
export { selectRenderablePlugins } from "./select.ts";
export type { SelectResult, SkippedPlugin } from "./select.ts";
export { loadFeaturePlugins } from "./registry.ts";
export type { PluginModuleMap } from "./registry.ts";

// The context version type is public — a plugin's `minCtxVersion` is compared
// against it — but the parse/compare helpers stay internal.
export type { CtxVersion } from "./version.ts";
