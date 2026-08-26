// web/src/lib/tilePatterns/index.ts
import { register, registry, getPattern } from "./pattern.ts";
import { gridGenerator } from "./grid.ts";
import { brick50, brick33 } from "./offset.ts";
import { diagonalGenerator } from "./diagonal.ts";
register(gridGenerator);
register(brick50); register(brick33); register(diagonalGenerator);
export { registry, getPattern };
export * from "./types.ts";
