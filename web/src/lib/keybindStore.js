// Browser-global keybinding overrides, persisted under their own key in the
// keyPath-less meta store (the templates/materials/stamps pattern — no DB bump).
// keymap.ts owns the live state; this module is the IndexedDB seam for it.
import { metaGet, metaPut, metaDelete } from "./store.js";
import { getOverrides, applyOverrides, resetAll } from "./keymap.ts";

export const KEYBIND_KEY = "keybindings";

// Load-complete gate: applyOverrides is the ONLY thing that mutates the live map
// from disk. Call this once at startup (app shell); the config modal stays
// disabled until it resolves so an early save can't be stomped by this read.
export async function loadKeybindOverrides() {
  const stored = await metaGet(KEYBIND_KEY);
  applyOverrides(stored && typeof stored === "object" ? stored : {});
}

export async function saveKeybindOverrides() {
  await metaPut(KEYBIND_KEY, getOverrides());
}

export async function clearKeybindOverrides() {
  await metaDelete(KEYBIND_KEY);
  resetAll();
}
