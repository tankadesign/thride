/**
 * Key-binding + navigation preset types. Pure data/DTO layer (no logic, no
 * imports from other layers). Consumed by core/keymap resolution, the ui keymap
 * store, and the render viewport input.
 */

/** Explicit modifier state — no cross-platform "mod" token at runtime. */
export interface ModifierSet {
  ctrl: boolean;
  meta: boolean;
  alt: boolean;
  shift: boolean;
}

/** A normalized keyboard chord: modifiers + a single key token. */
export interface KeyChord extends ModifierSet {
  /**
   * Physical key token: letters/digits use e.code-derived lowercase
   * ("a", "1"), named keys use lowercase e.key ("tab", "escape", "delete",
   * "enter", "arrowup", "f1"…).
   */
  key: string;
}

/**
 * Structural view of a KeyboardEvent so core/render code can resolve chords
 * without depending on the DOM `KeyboardEvent` type.
 */
export interface KeyEventLike {
  key: string;
  code: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
}

/** Named dispatch-time guard. v1: "editMode" = only fires in a component mode. */
export type BindingGuard = "editMode";

/** One key → command mapping in a preset. A command may appear multiple times. */
export interface KeyBindingEntry {
  /** AppCommand id. */
  command: string;
  /** Canonical chord string, e.g. "ctrl+shift+alt+k", "tab", "meta+z". */
  chord: string;
  /** Optional guard; binding is inert unless the guard passes. */
  when?: BindingGuard;
}

/** An editable, serializable keyboard preset. */
export interface KeyPreset {
  version: 1;
  id: string;
  name: string;
  /** Built-in presets are read-only in the UI and not persisted. */
  builtin?: boolean;
  keys: KeyBindingEntry[];
}

export type NavAction = "orbit" | "pan" | "dolly";

/** 0 = left, 1 = middle, 2 = right (matches PointerEvent.button). */
export type MouseButton = 0 | 1 | 2;

/** A mouse button + modifier combo that triggers a nav action. */
export interface MouseCombo {
  button: MouseButton;
  mods: ModifierSet;
}

export type NAV_PRESET_IDS = "threejs" | "c4d" | "blender";

/**
 * A built-in navigation scheme. Each action lists every combo that triggers it
 * (so one scheme can cover both mouse and trackpad, e.g. C4D pan = Alt+MMB and
 * Cmd+LMB). Wheel is always dolly-toward-cursor regardless of these.
 */
export interface NavPreset {
  id: NAV_PRESET_IDS | string;
  name: string;
  orbit: MouseCombo[];
  pan: MouseCombo[];
  dolly: MouseCombo[];
}

/** Fixed press-release click behaviors (not user-assignable in v1). */
export type ClickAction = "select" | "contextMenu" | "maximizePane";

/**
 * A resolved runtime mouse binding for a (button, mods) combo. `drag` starts a
 * camera nav past the drag threshold; `click` fires on a sub-threshold release.
 * When both are present the binding is "deferred" — the press is armed and the
 * outcome decided on move/up.
 */
export interface MouseBinding {
  button: MouseButton;
  mods: ModifierSet;
  drag?: NavAction;
  click?: ClickAction;
}
