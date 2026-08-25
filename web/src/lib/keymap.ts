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
