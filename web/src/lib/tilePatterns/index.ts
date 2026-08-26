// web/src/lib/tilePatterns/index.ts
import { register, registry, getPattern } from "./pattern.ts";
import { gridGenerator } from "./grid.ts";
register(gridGenerator);
export { registry, getPattern };
export * from "./types.ts";
