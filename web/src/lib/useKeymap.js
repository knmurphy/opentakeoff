// Reactive effective keymap for React surfaces (the config modal, guide tables,
// tool labels). Dispatch paths do NOT need this — they read the live keymap
// synchronously through matchCommand/matches at keydown time.
import { useSyncExternalStore } from "react";
import { subscribe, resolveKeymap, getOverrides } from "./keymap.ts";

const EMPTY = {};
let cache = EMPTY;

function getSnapshot() {
  // getOverrides returns a fresh object each call; useSyncExternalStore requires
  // a stable snapshot between changes, so cache by JSON identity.
  const o = getOverrides();
  const key = JSON.stringify(o);
  if (cache === EMPTY || cacheKey !== key) { cacheKey = key; cache = resolveKeymap(o); }
  return cache;
}
let cacheKey = "";

export function useKeymap() {
  // getServerSnapshot mirrors getSnapshot — this app is client-only, so the
  // cache is safe on both paths and React 18 won't warn on hydration.
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
