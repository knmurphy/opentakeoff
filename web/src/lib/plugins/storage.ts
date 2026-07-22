// Per-plugin key/value storage — an IRREVERSIBLE public surface, so it is
// deliberately narrow. A plugin gets a handle that reveals NOTHING about how it
// is backed: no `.scope`, no `.backend`, nothing enumerable that names the
// mechanism. `scope` is an INPUT (per-call opts), defaulting to `'device'`.
//
// v1 backs `'device'` only. `'project'` async-rejects UNIFORMLY with the device
// surface (a rejected promise, never a sync throw a plugin must guard) and the
// message names the SCOPE CONTRACT only — never the underlying store — so the
// backing stays swappable.
//
// The core owns the keyspace. Segments are LENGTH-PREFIXED, so no crafted key
// can climb into another plugin's namespace: ("a","b:c") and ("a:b","c") map to
// distinct physical keys.

/** The device-backed put/get/delete the storage handle delegates to. Injected
 *  so the node test runner can drive round-trips against fake-indexeddb's meta
 *  store without pulling the whole app store in. */
export interface MetaStore {
  get(key: string): Promise<unknown>;
  put(key: string, value: unknown): Promise<void>;
  delete(key: string): Promise<void>;
}

/** Frozen scope tokens. Exactly these two — a caller passing anything else
 *  async-rejects. */
export const STORAGE_SCOPES = Object.freeze(["device", "project"] as const);
export type StorageScope = (typeof STORAGE_SCOPES)[number];

export interface StorageOpts {
  readonly scope?: StorageScope;
}

/** The public storage handle. No property reveals the backing. */
export interface PluginStorage {
  get(key: string, opts?: StorageOpts): Promise<unknown>;
  set(key: string, value: unknown, opts?: StorageOpts): Promise<void>;
  remove(key: string, opts?: StorageOpts): Promise<void>;
}

const PROJECT_UNSUPPORTED = "project scope not yet supported";

/** Length-prefix a segment: `<len>:<segment>`. Because the length pins where a
 *  segment ends, a `:` inside one can't be mistaken for a delimiter, so two
 *  different (id, key) splits can never produce the same physical key. */
function seg(s: string): string {
  return `${s.length}:${s}`;
}

/** Physical key for a plugin's (id, key). `plugin/` prefix keeps it clear of
 *  the store's other namespaces (annotations, `sync:`, library). */
export function pluginStorageKey(pluginId: string, key: string): string {
  return `plugin/${seg(pluginId)}/${seg(key)}`;
}

/** Resolve the requested scope, rejecting anything but a v1-backed `'device'`.
 *  Async and uniform: unsupported scopes reject the returned promise rather than
 *  throw synchronously, and never name the backend. */
function requireDeviceScope(opts?: StorageOpts): Promise<void> {
  const scope: StorageScope = opts?.scope ?? "device";
  if (scope === "device") return Promise.resolve();
  if (scope === "project") return Promise.reject(new Error(PROJECT_UNSUPPORTED));
  return Promise.reject(new Error(`unknown storage scope`));
}

/** Mint a per-plugin storage handle over the given meta store. */
export function createPluginStorage(
  pluginId: string,
  meta: MetaStore,
): PluginStorage {
  const handle: PluginStorage = {
    get: (key, opts) =>
      requireDeviceScope(opts).then(() => meta.get(pluginStorageKey(pluginId, key))),
    set: (key, value, opts) =>
      requireDeviceScope(opts).then(() => meta.put(pluginStorageKey(pluginId, key), value)),
    remove: (key, opts) =>
      requireDeviceScope(opts).then(() => meta.delete(pluginStorageKey(pluginId, key))),
  };
  return handle;
}
