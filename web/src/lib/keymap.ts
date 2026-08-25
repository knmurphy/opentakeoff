// Keyboard-shortcut command model — the chord grammar, the command registry,
// resolution, matching, and the live keymap. Pure and DOM-free: KeyboardEvent is
// simulated with a plain object (like lib/keys.ts takes `navigator`), so it runs
// under node:test.

export type Category = "Tools" | "Navigation" | "Edit" | "Escape hatch";
export interface EventLike { key: string; shiftKey?: boolean; altKey?: boolean; metaKey?: boolean; ctrlKey?: boolean; }

const MODIFIERS = ["mod", "shift", "alt"] as const;

export function isModifierKey(key: string): boolean {
  return ["Shift", "Control", "Ctrl", "Alt", "Meta", "Option"].includes(key);
}

// One non-modifier key -> its canonical token: letters lowercase, digits and
// punctuation as-is ("?" stays "?"), named keys lowercase ("Escape" -> "escape").
function keyToken(key: string): string {
  if (key.length === 1) return /[a-zA-Z]/.test(key) ? key.toLowerCase() : key;
  return key.toLowerCase();
}

// "mod" is the primary modifier: ⌘ (metaKey) on macOS, Ctrl (ctrlKey) elsewhere.
function modsOf(e: { shiftKey?: boolean; altKey?: boolean; metaKey?: boolean; ctrlKey?: boolean }): string[] {
  const out: string[] = [];
  if (e.metaKey || e.ctrlKey) out.push("mod");
  if (e.shiftKey) out.push("shift");
  if (e.altKey) out.push("alt");
  return out;
}

export function normalizeEvent(e: EventLike): string | null {
  if (!e.key || isModifierKey(e.key)) return null; // incomplete — a modifier with no key
  return [...modsOf(e), keyToken(e.key)].join("+");
}

export function normalizeChord(chord: string): string | null {
  if (!chord) return null;
  const parts = chord.split("+");
  const mods: string[] = [];
  let key: string | null = null;
  for (const raw of parts) {
    const p = raw.trim().toLowerCase();
    if (p === "mod" || p === "shift" || p === "alt") {
      if (mods.includes(p)) return null; // duplicate modifier
      mods.push(p);
    } else {
      if (key !== null) return null; // two keys
      key = raw.trim();
    }
  }
  if (key === null) return null; // modifier-only
  const ordered = MODIFIERS.filter((m) => mods.includes(m));
  return [...ordered, keyToken(key)].join("+");
}

const GLYPH: Record<string, string> = { mod: "⌘", shift: "⇧", alt: "⌥", enter: "⏎", backspace: "⌫" };
const PC: Record<string, string> = { mod: "Ctrl", shift: "Shift", alt: "Alt", enter: "Enter", backspace: "Backspace", escape: "Esc", delete: "Delete" };

export function chordToKeys(chord: string, apple: boolean = typeof navigator === "undefined" ? false : /Mac|iPhone|iPad|iPod/i.test(navigator.platform)): string[] {
  return chord.split("+").map((p) => {
    if (apple) {
      if (p === "escape") return "Esc";
      if (p === "delete") return "Delete";
      return GLYPH[p] ?? (p.length === 1 ? p.toUpperCase() : p);
    }
    return PC[p] ?? (p.length === 1 ? p.toUpperCase() : p);
  });
}

// ── command registry ─────────────────────────────────────────────────────────
export interface CommandDef { label: string; category: Category; default: string | string[]; }

export const DEFAULT_KEYMAP: Readonly<Record<string, CommandDef>> = Object.freeze({
  oneclick:   { label: "One-Click Area", category: "Tools", default: "o" },
  area:       { label: "Area", category: "Tools", default: "a" },
  rect:       { label: "Rectangle", category: "Tools", default: "r" },
  linear:     { label: "Linear", category: "Tools", default: "l" },
  surface:    { label: "Surface Area", category: "Tools", default: "s" },
  count:      { label: "Count", category: "Tools", default: "c" },
  deduct:     { label: "Deduct shape", category: "Tools", default: "d" },
  "deduct-rect": { label: "Deduct rectangle", category: "Tools", default: "shift+d" },
  highlighter:{ label: "Highlighter", category: "Tools", default: "h" },
  dimension:  { label: "Dimension line", category: "Tools", default: "n" },
  check:      { label: "Check dimension", category: "Tools", default: "k" },
  select:     { label: "Select", category: "Tools", default: "v" },
  symbol:     { label: "Symbol sweep", category: "Tools", default: "y" },
  curveFlip:  { label: "Straight ⇄ Curve", category: "Tools", default: "q" },
  gallery:    { label: "Sheet gallery", category: "Navigation", default: "g" },
  focusMode:  { label: "Focus mode", category: "Navigation", default: "f" },
  guide:      { label: "Open this guide", category: "Navigation", default: "?" },
  undo:       { label: "Undo", category: "Edit", default: "mod+z" },
  redo:       { label: "Redo", category: "Edit", default: "mod+shift+z" },
  copy:       { label: "Copy", category: "Edit", default: "mod+c" },
  paste:      { label: "Paste", category: "Edit", default: "mod+v" },
  duplicate:  { label: "Duplicate", category: "Edit", default: "mod+d" },
  escape:     { label: "Back out one level · drop to Select", category: "Escape hatch", default: "escape" },
  commit:     { label: "Commit · create · accept", category: "Escape hatch", default: "enter" },
  deleteBack: { label: "Delete back one step", category: "Escape hatch", default: ["backspace", "delete"] },
});

// ── resolution & conflict ─────────────────────────────────────────────────────
export function resolveKeymap(overrides: Record<string, string>): Record<string, string[]> {
  const eff: Record<string, string[]> = {};
  for (const [id, def] of Object.entries(DEFAULT_KEYMAP)) {
    const bound = overrides[id] ?? def.default;
    eff[id] = Array.isArray(bound) ? bound : [bound];
  }
  return eff;
}

function reverseIndex(eff: Record<string, string[]>): Map<string, string> {
  const idx = new Map<string, string>();
  for (const [id, chords] of Object.entries(eff)) for (const c of chords) if (!idx.has(c)) idx.set(c, id);
  return idx;
}

// A chord collides if the EFFECTIVE map already assigns it to another command.
export function findConflict(chord: string, overrides: Record<string, string>, excludeId: string): string | null {
  const eff = resolveKeymap(overrides);
  const idx = reverseIndex(eff);
  const hit = idx.get(chord);
  return hit && hit !== excludeId ? hit : null;
}

// ── live keymap (module-level binding, like `export let store` in store.js) ──
let overrides: Record<string, string> = {};
let loaded = false;   // flips true when applyOverrides first runs (the startup load-complete gate)
const listeners = new Set<() => void>();
function notify() { for (const fn of listeners) fn(); }

export function getOverrides(): Record<string, string> { return { ...overrides }; }
export function isKeymapLoaded(): boolean { return loaded; }
export function applyOverrides(next: Record<string, string>): void { overrides = { ...next }; loaded = true; notify(); }
export function setOverride(commandId: string, chord: string): void { overrides = { ...overrides, [commandId]: chord }; notify(); }
export function resetCommand(commandId: string): void { if (!(commandId in overrides)) return; const n = { ...overrides }; delete n[commandId]; overrides = n; notify(); }
export function resetAll(): void { if (Object.keys(overrides).length === 0) return; overrides = {}; notify(); }
export function subscribe(fn: () => void): () => void { listeners.add(fn); return () => listeners.delete(fn); }

// ── matching ─────────────────────────────────────────────────────────────────
function commandForChord(eff: Record<string, string[]>, chord: string): string | null {
  const idx = reverseIndex(eff);
  const hit = idx.get(chord);
  if (hit) return hit;
  const parts = chord.split("+");
  if (parts.length === 2 && parts[0] === "shift") return idx.get(parts[1]) ?? null; // shift-insensitive fallback
  return null;
}

export function matchCommand(e: EventLike): string | null {
  const chord = normalizeEvent(e);
  if (!chord) return null;
  return commandForChord(resolveKeymap(overrides), chord);
}

export function matches(e: EventLike, commandId: string): boolean {
  return matchCommand(e) === commandId;
}
