import type { CtxVersion } from "./version.ts";
export interface SkippedPlugin {
    /** Best-effort id for the caller's warning; "(unknown)" if unreadable. */
    readonly id: string;
    readonly reason: string;
}
export interface SelectResult<T> {
    readonly rendered: T[];
    readonly skipped: SkippedPlugin[];
}
/** Bucket descriptors by whether the host context can render them. Generic over
 *  the descriptor-ish input so it composes with either raw or validated
 *  descriptors — it only reads `id` and `minCtxVersion`. */
export declare function selectRenderablePlugins<T>(plugins: readonly T[], ctxVersion: CtxVersion): SelectResult<T>;
