// The version gate — PURE. Given loaded descriptors and the host context
// version, it buckets each into `rendered` (major matches, host minor is high
// enough) or `skipped` (host too old / unparseable pin). It runs BEFORE any
// unknown-key rejection, so a descriptor pinned to a FUTURE context is skipped
// as "host too old" rather than hard-rejected for a key this host doesn't yet
// understand. No side effects: the caller emits the per-plugin warning from the
// `skipped` bucket (each entry names the plugin), keeping this testable by its
// return value alone.

import { descriptorVersion } from "./descriptor.ts";
import { satisfies, formatVersion } from "./version.ts";
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

function readId(desc: unknown): string {
  if (typeof desc === "object" && desc !== null) {
    const id = (desc as { id?: unknown }).id;
    if (typeof id === "string" && id.length > 0) return id;
  }
  return "(unknown)";
}

/** Bucket descriptors by whether the host context can render them. Generic over
 *  the descriptor-ish input so it composes with either raw or validated
 *  descriptors — it only reads `id` and `minCtxVersion`. */
export function selectRenderablePlugins<T>(
  plugins: readonly T[],
  ctxVersion: CtxVersion,
): SelectResult<T> {
  const rendered: T[] = [];
  const skipped: SkippedPlugin[] = [];
  for (const plugin of plugins) {
    const req = descriptorVersion(plugin);
    if (req === null) {
      skipped.push({ id: readId(plugin), reason: "unreadable minCtxVersion" });
      continue;
    }
    if (!satisfies(ctxVersion, req)) {
      skipped.push({
        id: readId(plugin),
        reason: `requires context ${formatVersion(req)}, host is ${formatVersion(ctxVersion)} (host too old)`,
      });
      continue;
    }
    rendered.push(plugin);
  }
  return { rendered, skipped };
}
