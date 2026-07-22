export interface CtxVersion {
    readonly major: number;
    readonly minor: number;
}
/** Parse a `"major.minor"` string into integer parts, or null if malformed. */
export declare function parseVersion(raw: unknown): CtxVersion | null;
/** Format a version pair back to its canonical `"major.minor"` string. A
 *  non-integer part renders as `?` rather than `undefined`/`NaN`, so a diagnostic
 *  built from a malformed host (only reachable by a mistyped caller — the app
 *  always passes the well-formed CANVAS_CONTEXT_VERSION) stays readable. */
export declare function formatVersion(v: CtxVersion): string;
/** Is a plugin requiring `req` renderable on a host advertising `host`?
 *  Rule: SAME major AND host.minor >= req.minor. A newer host major is a
 *  breaking boundary — a plugin built for major 1 is NOT run on host major 2. */
export declare function satisfies(host: CtxVersion, req: CtxVersion): boolean;
