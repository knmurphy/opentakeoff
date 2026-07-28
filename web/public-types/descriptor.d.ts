import type { CtxVersion } from "./version.ts";
import type { CanvasContext } from "./context.ts";
/** A render-time overlay slot. `render` returns the host's element type; typed
 *  `unknown` here because the pure core is React-free (the host in slice 2b
 *  supplies the renderer). */
export interface OverlaySlot {
    readonly id: string;
    readonly label: string;
    readonly icon?: string;
    readonly render: (props: {
        ctx: CanvasContext;
        onClose: () => void;
    }) => unknown;
}
/** An action-time export slot. `onSelect` performs its own `ctx.download`;
 *  it returns nothing (void) — harmonizes with ReportPanel's no-arg menu. */
export interface ExportSlot {
    readonly id: string;
    readonly label: string;
    readonly onSelect: (ctx: CanvasContext) => void;
}
/** The frozen v1 descriptor. Exactly these four keys. */
export interface PluginDescriptor {
    readonly id: string;
    readonly minCtxVersion: string;
    readonly overlays: readonly OverlaySlot[];
    readonly exports: readonly ExportSlot[];
}
export declare const DESCRIPTOR_KEYS: readonly ["id", "minCtxVersion", "overlays", "exports"];
export type ValidateResult = {
    readonly ok: true;
    readonly descriptor: PluginDescriptor;
} | {
    readonly ok: false;
    readonly reason: string;
};
/** Host-agnostic structural validation. Does NOT gate on host version — the
 *  version gate is `selectRenderablePlugins`, run FIRST, so this only ever sees
 *  version-compatible descriptors and its unknown-key rejection can be strict.
 *  Returns a discriminated result; never throws. */
export declare function validateDescriptor(desc: unknown): ValidateResult;
/** Is a descriptor eligible for activation? `__*__`-named ids are reserved
 *  (the CI canary) — they bundle so the glob stays live, but never activate. */
export declare function isActivatable(desc: PluginDescriptor): boolean;
/** Parse a descriptor's pinned context version, or null if malformed. Used by
 *  the version gate before any key-strictness runs. */
export declare function descriptorVersion(desc: unknown): CtxVersion | null;
