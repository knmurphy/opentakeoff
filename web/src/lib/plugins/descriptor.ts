// The frozen plugin descriptor — the semver'd public surface a community plugin
// pins to. In v1 the closed key set is EXACTLY `{ id, minCtxVersion, overlays,
// exports }`. It grows only by a MINOR context bump when a real consumer lands
// (`panels` / `setup` / `agentTools` are explicitly out of v1). Any key not in
// the frozen set is rejected — but only AFTER the version gate: a descriptor
// pinned to a future context is version-skipped, never hard-rejected for a key
// this host doesn't yet understand (see selectRenderablePlugins).
//
// Two ctx-passing conventions are frozen up front:
//   overlays: render-time  `render({ ctx, onClose })` → element
//   exports:  action-time   void `onSelect(ctx)`  (does its own ctx.download)

import { parseVersion } from "./version.ts";
import type { CtxVersion } from "./version.ts";
import type { CanvasContext } from "./context.ts";

/** A render-time overlay slot. `render` returns the host's element type; typed
 *  `unknown` here because the pure core is React-free (the host in slice 2b
 *  supplies the renderer). */
export interface OverlaySlot {
  readonly id: string;
  readonly label: string;
  readonly icon?: string;
  readonly render: (props: { ctx: CanvasContext; onClose: () => void }) => unknown;
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

// The single source of truth for the frozen key set. `validateDescriptor`
// rejects any key outside it. Freezing it makes the surface-lock test real.
export const DESCRIPTOR_KEYS = Object.freeze([
  "id",
  "minCtxVersion",
  "overlays",
  "exports",
] as const);

export type ValidateResult =
  | { readonly ok: true; readonly descriptor: PluginDescriptor }
  | { readonly ok: false; readonly reason: string };

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function validateSlotArray(
  value: unknown,
  slot: "overlays" | "exports",
  fnKey: "render" | "onSelect",
): string | null {
  if (!Array.isArray(value)) return `${slot} must be an array`;
  for (const item of value) {
    if (!isPlainObject(item)) return `${slot} entries must be objects`;
    if (typeof item.id !== "string" || item.id.length === 0)
      return `${slot} entries need a string id`;
    if (typeof item.label !== "string" || item.label.length === 0)
      return `${slot} entries need a string label`;
    if (typeof item[fnKey] !== "function")
      return `${slot} entries need a ${fnKey}() function`;
  }
  return null;
}

function buildOverlays(value: readonly unknown[]): OverlaySlot[] {
  return value.map((raw) => {
    const item = raw as Record<string, unknown>;
    const slot: OverlaySlot = {
      id: item.id as string,
      label: item.label as string,
      render: item.render as OverlaySlot["render"],
    };
    return typeof item.icon === "string" ? { ...slot, icon: item.icon } : slot;
  });
}

function buildExports(value: readonly unknown[]): ExportSlot[] {
  return value.map((raw) => {
    const item = raw as Record<string, unknown>;
    return {
      id: item.id as string,
      label: item.label as string,
      onSelect: item.onSelect as ExportSlot["onSelect"],
    };
  });
}

/** Host-agnostic structural validation. Does NOT gate on host version — the
 *  version gate is `selectRenderablePlugins`, run FIRST, so this only ever sees
 *  version-compatible descriptors and its unknown-key rejection can be strict.
 *  Returns a discriminated result; never throws. */
export function validateDescriptor(desc: unknown): ValidateResult {
  if (!isPlainObject(desc)) return { ok: false, reason: "descriptor is not an object" };

  for (const key of Object.keys(desc)) {
    if (!(DESCRIPTOR_KEYS as readonly string[]).includes(key))
      return { ok: false, reason: `unknown descriptor key "${key}"` };
  }

  if (typeof desc.id !== "string" || desc.id.length === 0)
    return { ok: false, reason: "descriptor.id must be a non-empty string" };
  if (parseVersion(desc.minCtxVersion) === null)
    return { ok: false, reason: "descriptor.minCtxVersion must be \"major.minor\"" };

  const overlayErr = validateSlotArray(desc.overlays, "overlays", "render");
  if (overlayErr) return { ok: false, reason: overlayErr };
  const exportErr = validateSlotArray(desc.exports, "exports", "onSelect");
  if (exportErr) return { ok: false, reason: exportErr };

  // Build the descriptor from validated fields rather than assert the whole
  // input: unknown keys are already rejected, and each field is narrowed by the
  // checks above, so no wholesale `as unknown as` is needed.
  const descriptor: PluginDescriptor = {
    id: desc.id,
    minCtxVersion: desc.minCtxVersion as string,
    overlays: buildOverlays(desc.overlays as readonly unknown[]),
    exports: buildExports(desc.exports as readonly unknown[]),
  };
  return { ok: true, descriptor };
}

/** Is a descriptor eligible for activation? `__*__`-named ids are reserved
 *  (the CI canary) — they bundle so the glob stays live, but never activate. */
export function isActivatable(desc: PluginDescriptor): boolean {
  return !/^__.*__$/.test(desc.id);
}

/** Parse a descriptor's pinned context version, or null if malformed. Used by
 *  the version gate before any key-strictness runs. */
export function descriptorVersion(desc: unknown): CtxVersion | null {
  if (!isPlainObject(desc)) return null;
  return parseVersion(desc.minCtxVersion);
}
