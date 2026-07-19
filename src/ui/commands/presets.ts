import type { KeyBindingEntry, KeyPreset, NAV_PRESET_IDS, NavPreset } from "@/types/keymap";

/**
 * Built-in presets. Navigation presets are read-only schemes (each nav action
 * lists every mouse/trackpad combo that triggers it). Key presets are the
 * starting points a user duplicates to make an editable custom preset; their
 * chord strings may use the "mod" token (⌘ on mac / Ctrl elsewhere), expanded
 * to explicit modifiers when the active preset is resolved.
 */

const noMods = { ctrl: false, meta: false, alt: false, shift: false };

/** Built-in navigation schemes (mouse + trackpad). Wheel always dollies. */
export const NAV_PRESETS: NavPreset[] = [
  {
    id: "threejs",
    name: "three.js (OrbitControls)",
    // Bare left-drag orbit, right-drag pan (right-click still opens the menu),
    // wheel to dolly.
    orbit: [{ button: 0, mods: { ...noMods } }],
    pan: [{ button: 2, mods: { ...noMods } }],
    dolly: [],
  },
  {
    id: "c4d",
    name: "Cinema 4D",
    // Alt+drag orbit/pan/dolly; plus Cmd+LMB pan and Cmd+Alt+LMB dolly so a
    // one-button trackpad can still navigate.
    orbit: [{ button: 0, mods: { ...noMods, alt: true } }],
    pan: [
      { button: 1, mods: { ...noMods, alt: true } },
      { button: 0, mods: { ...noMods, meta: true } },
    ],
    dolly: [
      { button: 2, mods: { ...noMods, alt: true } },
      { button: 0, mods: { ...noMods, meta: true, alt: true } },
    ],
  },
  {
    id: "blender",
    name: "Blender",
    orbit: [{ button: 1, mods: { ...noMods } }],
    pan: [{ button: 1, mods: { ...noMods, shift: true } }],
    dolly: [{ button: 1, mods: { ...noMods, ctrl: true } }],
  },
];

/** The C4D keyboard map — today's shortcuts, shared as the base for Blender. */
const C4D_KEYS: KeyBindingEntry[] = [
  { command: "edit.undo", chord: "mod+z" },
  { command: "edit.redo", chord: "shift+mod+z" },
  // both Delete and Backspace delete (the old handler treated them alike)
  { command: "edit.delete", chord: "delete" },
  { command: "edit.delete", chord: "backspace" },
  { command: "edit.group", chord: "mod+g" },
  { command: "edit.ungroup", chord: "shift+mod+g" },
  { command: "edit.convertToMesh", chord: "c" },
  { command: "edit.selectAll", chord: "mod+a" },
  { command: "edit.deselect", chord: "mod+d" },
  { command: "spline.pen", chord: "p" },
  { command: "mesh.extrude", chord: "d" },
  { command: "mesh.inset", chord: "i" },
  { command: "mesh.bevel", chord: "b" },
  { command: "view.toggleLayout", chord: "mod+4" },
  { command: "view.toggleWorldMode", chord: "w" },
  { command: "view.frameSelection", chord: "f" },
  { command: "view.frameAll", chord: "h" },
  { command: "view.palette", chord: "mod+k" },
  // gizmo modes (were hardcoded E/R/T/V in ViewportInput)
  { command: "gizmo.translate", chord: "e" },
  { command: "gizmo.rotate", chord: "r" },
  { command: "gizmo.scale", chord: "t" },
  { command: "gizmo.all", chord: "v" },
];

export const BUILTIN_KEY_PRESETS: KeyPreset[] = [
  { version: 1, id: "c4d", name: "Cinema 4D", builtin: true, keys: C4D_KEYS },
  {
    version: 1,
    id: "blender",
    name: "Blender",
    builtin: true,
    keys: [
      ...C4D_KEYS,
      // Tab flips object ↔ last edit mode; 1/2/3 pick a component mode but only
      // while already in edit mode (Blender behaviour).
      { command: "mode.toggleEdit", chord: "tab" },
      { command: "mode.point", chord: "1", when: "editMode" },
      { command: "mode.edge", chord: "2", when: "editMode" },
      { command: "mode.polygon", chord: "3", when: "editMode" },
    ],
  },
];

/** The default preset ids used when a stored id is missing/stale. */
export const DEFAULT_NAV_PRESET_ID: NAV_PRESET_IDS | string = "threejs";
export const DEFAULT_KEY_PRESET_ID: NAV_PRESET_IDS | string = "c4d";
