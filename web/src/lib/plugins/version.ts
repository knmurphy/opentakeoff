// Context version arithmetic. The canvas context is versioned `major.minor`:
// a MINOR bump is additive (a new accessor / a new descriptor slot) and an old
// plugin keeps working; a MAJOR bump is reserved for a breaking change and
// intentionally strands plugins pinned to the prior major until they opt in.
//
// Versions are parsed to `{ major, minor }` INTEGER pairs, never a JS float:
// `1.10` as a number collapses to `1.1`, tying minor 10 with minor 1. Compare
// on the pair, not the string.

export interface CtxVersion {
  readonly major: number;
  readonly minor: number;
}

const VERSION_RE = /^(\d+)\.(\d+)$/;

/** Parse a `"major.minor"` string into integer parts, or null if malformed. */
export function parseVersion(raw: unknown): CtxVersion | null {
  if (typeof raw !== "string") return null;
  const m = VERSION_RE.exec(raw);
  if (!m) return null;
  return { major: Number(m[1]), minor: Number(m[2]) };
}

/** Format a version pair back to its canonical `"major.minor"` string. */
export function formatVersion(v: CtxVersion): string {
  return `${v.major}.${v.minor}`;
}

/** Is a plugin requiring `req` renderable on a host advertising `host`?
 *  Rule: SAME major AND host.minor >= req.minor. A newer host major is a
 *  breaking boundary — a plugin built for major 1 is NOT run on host major 2. */
export function satisfies(host: CtxVersion, req: CtxVersion): boolean {
  return host.major === req.major && host.minor >= req.minor;
}
