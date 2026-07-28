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
export declare const STORAGE_SCOPES: readonly ["device", "project"];
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
/** Physical key for a plugin's (id, key). `plugin/` prefix keeps it clear of
 *  the store's other namespaces (annotations, `sync:`, library). */
export declare function pluginStorageKey(pluginId: string, key: string): string;
/** Mint a per-plugin storage handle over the given meta store. */
export declare function createPluginStorage(pluginId: string, meta: MetaStore): PluginStorage;
