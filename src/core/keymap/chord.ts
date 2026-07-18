import type { KeyChord, KeyEventLike, ModifierSet, MouseButton, MouseCombo } from "@/types/keymap";

const NO_MODS: ModifierSet = { ctrl: false, meta: false, alt: false, shift: false };

/** Read the modifier state off any KeyboardEvent/PointerEvent-like value. */
export function modsOf(e: KeyEventLike | MouseEvent): ModifierSet {
  return { ctrl: e.ctrlKey, meta: e.metaKey, alt: e.altKey, shift: e.shiftKey };
}

export function modsEqual(a: ModifierSet, b: ModifierSet): boolean {
  return a.ctrl === b.ctrl && a.meta === b.meta && a.alt === b.alt && a.shift === b.shift;
}

export function chordsEqual(a: KeyChord, b: KeyChord): boolean {
  return a.key === b.key && modsEqual(a, b);
}

/** True when the chord requires ⌘ or Ctrl (used by the typing-field gate). */
export function hasCmdOrCtrl(c: KeyChord): boolean {
  return c.ctrl || c.meta;
}

/**
 * Physical key token for a keyboard event:
 * - letters/digits from e.code (KeyA→"a", Digit1→"1") so mac Alt-combos and
 *   Shift+digit still resolve (e.key would give "†" / "!" there),
 * - named keys from lowercased e.key ("tab", "escape", "arrowup"…).
 * International note: code-based digits/letters mean an AZERTY user binds the
 * physical key position, matching Blender's behavior — an accepted trade-off.
 */
function keyToken(e: KeyEventLike): string | null {
  const code = e.code;
  const letter = /^Key([A-Z])$/.exec(code);
  if (letter) return letter[1].toLowerCase();
  const digit = /^Digit([0-9])$/.exec(code);
  if (digit) return digit[1];
  const key = e.key;
  if (key === "Control" || key === "Shift" || key === "Alt" || key === "Meta") return null;
  if (key === " " || code === "Space") return "space";
  return key.toLowerCase();
}

/** Resolve a key event to a chord, or null for a bare modifier press. */
export function chordFromEvent(e: KeyEventLike): KeyChord | null {
  const key = keyToken(e);
  if (!key) return null;
  return { ...modsOf(e), key };
}

/** Parse a canonical (or definition-time, order-free) chord string. */
export function parseChord(s: string): KeyChord {
  const parts = s.split("+");
  const chord: KeyChord = { ...NO_MODS, key: "" };
  for (const p of parts) {
    if (p === "ctrl") chord.ctrl = true;
    else if (p === "alt") chord.alt = true;
    else if (p === "shift") chord.shift = true;
    else if (p === "meta") chord.meta = true;
    else chord.key = p;
  }
  return chord;
}

/** Serialize a chord to its canonical string. */
export function formatChord(c: KeyChord): string {
  const parts: string[] = [];
  if (c.ctrl) parts.push("ctrl");
  if (c.alt) parts.push("alt");
  if (c.shift) parts.push("shift");
  if (c.meta) parts.push("meta");
  parts.push(c.key);
  return parts.join("+");
}

/** Replace the cross-platform "mod" token with meta (mac) / ctrl (else). */
export function expandMod(s: string, isMac: boolean): string {
  return s
    .split("+")
    .map((p) => (p === "mod" ? (isMac ? "meta" : "ctrl") : p))
    .join("+");
}

/** Human label for a single key token. */
function keyDisplay(key: string): string {
  if (key.length === 1) return key.toUpperCase();
  const named: Record<string, string> = {
    escape: "Esc",
    delete: "Del",
    backspace: "⌫",
    enter: "Enter",
    tab: "Tab",
    space: "Space",
    arrowup: "↑",
    arrowdown: "↓",
    arrowleft: "←",
    arrowright: "→",
  };
  return named[key] ?? key.charAt(0).toUpperCase() + key.slice(1);
}

/**
 * Human-readable chord label. Mac renders a glyph run (⌃⌥⇧⌘K, Apple order);
 * other platforms use "Ctrl+Alt+Shift+K".
 */
export function chordLabel(c: KeyChord, isMac: boolean): string {
  if (isMac) {
    let out = "";
    if (c.ctrl) out += "⌃";
    if (c.alt) out += "⌥";
    if (c.shift) out += "⇧";
    if (c.meta) out += "⌘";
    return out + keyDisplay(c.key);
  }
  const parts: string[] = [];
  if (c.ctrl) parts.push("Ctrl");
  if (c.alt) parts.push("Alt");
  if (c.shift) parts.push("Shift");
  if (c.meta) parts.push("Win");
  parts.push(keyDisplay(c.key));
  return parts.join("+");
}

const BUTTON_NAME: Record<MouseButton, string> = {
  0: "Left",
  1: "Middle",
  2: "Right",
};

/** Modifier prefix for a mouse combo, matching chordLabel's platform style. */
function modPrefix(mods: ModifierSet, isMac: boolean): string {
  if (isMac) {
    let out = "";
    if (mods.ctrl) out += "⌃";
    if (mods.alt) out += "⌥";
    if (mods.shift) out += "⇧";
    if (mods.meta) out += "⌘";
    return out;
  }
  const parts: string[] = [];
  if (mods.ctrl) parts.push("Ctrl");
  if (mods.alt) parts.push("Alt");
  if (mods.shift) parts.push("Shift");
  if (mods.meta) parts.push("Win");
  return parts.length ? parts.join("+") + "+" : "";
}

/** e.g. "⌥ Middle-drag" (mac) / "Alt+Middle-drag" (else). */
export function comboLabel(combo: MouseCombo, isMac: boolean): string {
  const prefix = modPrefix(combo.mods, isMac);
  const sep = isMac && prefix ? " " : "";
  return `${prefix}${sep}${BUTTON_NAME[combo.button]}-drag`;
}
