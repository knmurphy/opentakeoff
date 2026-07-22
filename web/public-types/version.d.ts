export interface CtxVersion {
    readonly major: number;
    readonly minor: number;
}
/** Parse a `"major.minor"` string into integer parts, or null if malformed. */
export declare function parseVersion(raw: unknown): CtxVersion | null;
/** Format a version pair back to its canonical `"major.minor"` string. */
export declare function formatVersion(v: CtxVersion): string;
/** Is a plugin requiring `req` renderable on a host advertising `host`?
 *  Rule: SAME major AND host.minor >= req.minor. A newer host major is a
 *  breaking boundary — a plugin built for major 1 is NOT run on host major 2. */
export declare function satisfies(host: CtxVersion, req: CtxVersion): boolean;
