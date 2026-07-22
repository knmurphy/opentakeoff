import type { PluginDescriptor } from "./descriptor.ts";
import type { CtxVersion } from "./version.ts";
/** A lazy module map: path → thunk resolving to a module namespace. This is the
 *  exact shape `import.meta.glob` produces, so real builds and tests share one
 *  loader. */
export type PluginModuleMap = Record<string, () => Promise<unknown>>;
/** Load every in-tree feature descriptor for the given host context version.
 *  Never throws. Pipeline, in order:
 *    1. resolve modules (a throwing thunk is logged + skipped),
 *    2. VERSION GATE (`selectRenderablePlugins`) — a future-pinned plugin is
 *       skipped with a plugin-naming warning, BEFORE any key strictness,
 *    3. structural `validateDescriptor` on the version-compatible set (now
 *       unknown-key rejection is safe),
 *    4. drop reserved `__*__` dirs (the CI canary) before activation,
 *    5. reject duplicate ids.
 *  Returns the activatable descriptors. */
export declare function loadFeaturePlugins(modules?: PluginModuleMap, hostVersion?: CtxVersion): Promise<PluginDescriptor[]>;
