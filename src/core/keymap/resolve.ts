import type {
  ClickAction,
  KeyBindingEntry,
  KeyChord,
  KeyPreset,
  ModifierSet,
  MouseBinding,
  MouseButton,
  MouseCombo,
  NavAction,
  NavPreset,
} from "@/types/keymap";
import { formatChord, modsEqual, parseChord } from "./chord";

const NO_MODS: ModifierSet = { ctrl: false, meta: false, alt: false, shift: false };

function noMods(mods: ModifierSet): boolean {
  return !mods.ctrl && !mods.meta && !mods.alt && !mods.shift;
}

function comboKey(button: MouseButton, mods: ModifierSet): string {
  return `${button}:${mods.ctrl ? 1 : 0}${mods.alt ? 1 : 0}${mods.shift ? 1 : 0}${mods.meta ? 1 : 0}`;
}

/** The three fixed press-release behaviors (button → action), all no-mods. */
const FIXED_CLICKS: Array<[MouseButton, ClickAction]> = [
  [0, "select"],
  [2, "contextMenu"],
  [1, "maximizePane"],
];

/**
 * Flatten a nav preset into runtime mouse bindings: every nav combo becomes a
 * drag binding; the three fixed click behaviors are injected; a drag combo that
 * collides with a click behavior (same button no-mods, or LMB with only
 * selection modifiers) merges into a single deferred drag+click binding.
 */
export function deriveMouseBindings(nav: NavPreset): MouseBinding[] {
  const map = new Map<string, MouseBinding>();
  for (const [button, click] of FIXED_CLICKS) {
    map.set(comboKey(button, NO_MODS), { button, mods: { ...NO_MODS }, click });
  }
  const add = (action: NavAction, combo: MouseCombo): void => {
    const { button, mods } = combo;
    const key = comboKey(button, mods);
    const existing = map.get(key);
    if (existing) {
      // no-mods collision with a fixed click → deferred (drag OR click)
      existing.drag = action;
      return;
    }
    // LMB + selection modifiers (never alt) also defers to a modifier-op select
    const selectClick = button === 0 && !mods.alt && (mods.shift || mods.ctrl || mods.meta);
    map.set(key, {
      button,
      mods: { ...mods },
      drag: action,
      ...(selectClick ? { click: "select" } : {}),
    });
  };
  for (const c of nav.orbit) add("orbit", c);
  for (const c of nav.pan) add("pan", c);
  for (const c of nav.dolly) add("dolly", c);
  return [...map.values()];
}

/**
 * Resolve a (button, mods) press to its binding. Exact match wins; otherwise,
 * if the extra modifiers are only selection modifiers (shift/ctrl/meta, never
 * alt), fall back to the button's no-mods binding — this keeps shift-click-add
 * and cmd-click-toggle working under every nav preset.
 */
export function matchMouseBinding(
  bindings: readonly MouseBinding[],
  button: number,
  mods: ModifierSet,
): MouseBinding | null {
  for (const b of bindings) {
    if (b.button === button && modsEqual(b.mods, mods)) return b;
  }
  if (!mods.alt) {
    for (const b of bindings) {
      if (b.button === button && noMods(b.mods)) return b;
    }
  }
  return null;
}

/** Chord (canonical) → the binding entries mapped to it in this key preset. */
export function buildKeyLookup(preset: KeyPreset): Map<string, KeyBindingEntry[]> {
  const map = new Map<string, KeyBindingEntry[]>();
  for (const entry of preset.keys) {
    const key = formatChord(parseChord(entry.chord));
    const arr = map.get(key);
    if (arr) arr.push(entry);
    else map.set(key, [entry]);
  }
  return map;
}

/** All chords bound to a command in this preset (for menu/palette labels). */
export function bindingsForCommand(preset: KeyPreset, command: string): KeyChord[] {
  return preset.keys.filter((e) => e.command === command).map((e) => parseChord(e.chord));
}

/** Chords bound to more than one distinct command (for the UI conflict warning). */
export function findConflicts(preset: KeyPreset): { chord: string; entries: KeyBindingEntry[] }[] {
  const lookup = buildKeyLookup(preset);
  const out: { chord: string; entries: KeyBindingEntry[] }[] = [];
  for (const [chord, entries] of lookup) {
    const commands = new Set(entries.map((e) => e.command));
    if (commands.size > 1) out.push({ chord, entries });
  }
  return out;
}
