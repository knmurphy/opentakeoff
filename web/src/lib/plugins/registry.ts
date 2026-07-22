/// <reference types="vite/client" />
// In-tree feature registry — the fork/private composition path. Each feature is
// a folder under src/features/<name>/ exporting a default descriptor from
// plugin.{js,jsx}. A downstream fork drops feature folders in; public core ships
// none but the CI canary; and every `git merge public/main` leaves them alone.
//
// The glob is LAZY (no `{ eager: true }`) so each feature resolves to its own
// async chunk — an opted-out build never pulls plugin code into the entry
// bundle (Axis A). The module map is dependency-injected (default arg) so the
// node test runner, which has no `import.meta.glob`, can drive the loader with a
// hand-built map.
//
// Load order matters: the VERSION GATE runs before unknown-key rejection, so a
// plugin pinned to a future context is version-skipped (warned as "host too
// old"), not hard-rejected for carrying a key this host doesn't yet know.

import { validateDescriptor, isActivatable } from "./descriptor.ts";
import type { PluginDescriptor } from "./descriptor.ts";
import { selectRenderablePlugins } from "./select.ts";
import { CANVAS_CONTEXT_VERSION } from "./context.ts";
import type { CtxVersion } from "./version.ts";

/** A lazy module map: path → thunk resolving to a module namespace. This is the
 *  exact shape `import.meta.glob` produces, so real builds and tests share one
 *  loader. */
export type PluginModuleMap = Record<string, () => Promise<unknown>>;

interface LoadedModule {
  readonly path: string;
  readonly descriptor: unknown;
}

/** Resolve every module map thunk, skipping (with a logged reason) any whose
 *  thunk throws so one broken plugin can't take down load. */
async function resolveModules(modules: PluginModuleMap): Promise<LoadedModule[]> {
  const loaded: LoadedModule[] = [];
  for (const path of Object.keys(modules)) {
    try {
      const mod = await modules[path]();
      const descriptor = (mod as { default?: unknown } | null | undefined)?.default;
      loaded.push({ path, descriptor });
    } catch (err) {
      console.warn(`[plugins] skipped ${path}: module threw during load`, err);
    }
  }
  return loaded;
}

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
export async function loadFeaturePlugins(
  // The bare `import.meta.glob` — a Vite BUILD-TIME macro — is confined to this
  // default-parameter position. Default expressions evaluate only when the arg
  // is omitted, at CALL time: the real build calls with no args, so Vite
  // transforms the glob into the per-feature lazy-import map here (each feature
  // its own chunk); the node tests always pass `modules`, so tsx never touches
  // `import.meta.glob` (which is undefined outside Vite) and the module still
  // imports cleanly.
  modules: PluginModuleMap = import.meta.glob("../../features/*/plugin.{js,jsx}"),
  hostVersion: CtxVersion = CANVAS_CONTEXT_VERSION,
): Promise<PluginDescriptor[]> {
  const loaded = await resolveModules(modules);

  // VERSION GATE first, on the raw descriptors — a future-pinned plugin is
  // skipped before its unknown keys are ever inspected.
  const { rendered, skipped } = selectRenderablePlugins(
    loaded.map((m) => m.descriptor),
    hostVersion,
  );
  for (const s of skipped) {
    console.warn(`[plugins] version-skip "${s.id}": ${s.reason}`);
  }

  const out: PluginDescriptor[] = [];
  const seen = new Set<string>();
  for (const descriptor of rendered) {
    const result = validateDescriptor(descriptor);
    if (!result.ok) {
      console.warn(`[plugins] skipped plugin: ${result.reason}`);
      continue;
    }
    if (!isActivatable(result.descriptor)) continue;
    if (seen.has(result.descriptor.id)) {
      console.warn(`[plugins] skipped duplicate id "${result.descriptor.id}"`);
      continue;
    }
    seen.add(result.descriptor.id);
    out.push(result.descriptor);
  }
  return out;
}
