// web/src/lib/tilePatterns/pattern.ts
import type { PatternGenerator } from "./types.ts";
export const registry = new Map<string, PatternGenerator>();
export function register(g: PatternGenerator) { registry.set(g.name, g); }
export function getPattern(name: string): PatternGenerator {
  const g = registry.get(name);
  if (!g) throw new Error(`unknown tile pattern: ${name}`);
  return g;
}
