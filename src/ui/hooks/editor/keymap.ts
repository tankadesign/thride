import { atom, useAtomValue } from "jotai";
import { atomWithStorage } from "jotai/utils";
import type { Document } from "@/core";
import { uuidv7 } from "@/core";
import { ConvertToMeshCommand } from "@/geometry/commands/convert";
import type { ComponentMode, EditMode } from "@/types/core";
import type {
  BindingGuard,
  KeyEventLike,
  KeyPreset,
  MouseBinding,
  NavPreset,
} from "@/types/keymap";
import {
  chordFromEvent,
  chordLabel,
  expandMod,
  formatChord,
  parseChord,
} from "@/core/keymap/chord";
import { bindingsForCommand, buildKeyLookup, deriveMouseBindings } from "@/core/keymap/resolve";
import {
  BUILTIN_KEY_PRESETS,
  DEFAULT_KEY_PRESET_ID,
  DEFAULT_NAV_PRESET_ID,
  NAV_PRESETS,
} from "@/ui/commands/presets";
import { appStore } from "@/ui/hooks/doc/document";
import { registryAtom } from "./shell";

const IS_MAC = typeof navigator !== "undefined" && /Mac/.test(navigator.platform);

/** Human label for a chord, using this platform's glyphs. */
export function labelChord(chord: string): string {
  return chordLabel(parseChord(chord), IS_MAC);
}
export { IS_MAC };

// ---- persisted selection + custom presets ----------------------------------

export const activeNavPresetIdAtom = atomWithStorage(
  "thride.settings.keymap.nav",
  DEFAULT_NAV_PRESET_ID,
);
export const activeKeyPresetIdAtom = atomWithStorage(
  "thride.settings.keymap.keys",
  DEFAULT_KEY_PRESET_ID,
);
export const customKeyPresetsAtom = atomWithStorage<KeyPreset[]>(
  "thride.settings.keymap.custom",
  [],
);

/** Set while the key-capture recorder is live so the Shell handler stands down. */
export const keyCaptureActiveAtom = atom(false);

/** Last component mode entered — the target of the object↔edit toggle. */
export const lastComponentModeAtom = atom<ComponentMode>("point");

// ---- derived resolution ----------------------------------------------------

/** Expand "mod" and canonicalize every chord (built-ins carry "mod"). */
function resolvePreset(p: KeyPreset): KeyPreset {
  return {
    ...p,
    keys: p.keys.map((k) => ({ ...k, chord: formatChord(parseChord(expandMod(k.chord, IS_MAC))) })),
  };
}

export const activeNavPresetAtom = atom<NavPreset>((get) => {
  const id = get(activeNavPresetIdAtom);
  return NAV_PRESETS.find((p) => p.id === id) ?? NAV_PRESETS[0]!;
});

export const allKeyPresetsAtom = atom<KeyPreset[]>((get) => [
  ...BUILTIN_KEY_PRESETS,
  ...get(customKeyPresetsAtom),
]);

export const activeKeyPresetAtom = atom<KeyPreset>((get) => {
  const id = get(activeKeyPresetIdAtom);
  const found = get(allKeyPresetsAtom).find((p) => p.id === id) ?? BUILTIN_KEY_PRESETS[0]!;
  return resolvePreset(found);
});

export const mouseBindingsAtom = atom<MouseBinding[]>((get) =>
  deriveMouseBindings(get(activeNavPresetAtom)),
);
export const keyLookupAtom = atom((get) => buildKeyLookup(get(activeKeyPresetAtom)));

// ---- dispatch-time guards --------------------------------------------------

const GUARDS: Record<BindingGuard, (doc: Document) => boolean> = {
  editMode: (doc) => doc.selection.editMode !== "object",
};

/**
 * Resolve a key event against the active preset. `viewportScoped` selects which
 * side owns it: the Shell handler runs non-viewport commands, ViewportInput
 * runs the viewport-scoped ones (with its own pointer/busy gating).
 */
function resolveCommand(
  e: KeyEventLike,
  wantViewportScoped: boolean,
  doc: Document | null,
): string | null {
  const chord = chordFromEvent(e);
  if (!chord) return null;
  const entries = appStore.get(keyLookupAtom).get(formatChord(chord));
  if (!entries) return null;
  const registry = appStore.get(registryAtom);
  if (!registry) return null;
  for (const entry of entries) {
    const cmd = registry.get(entry.command);
    if (!cmd) continue;
    if (!!cmd.viewportScoped !== wantViewportScoped) continue;
    // a guarded binding needs the doc to evaluate; skip it if we don't have one
    if (entry.when && !(doc && GUARDS[entry.when](doc))) continue;
    if (!(cmd.enabled?.() ?? true)) continue;
    return entry.command;
  }
  return null;
}

/**
 * Global keyboard dispatch (replaces CommandRegistry.handleKey). Runs the first
 * matching non-viewport command and returns true (the caller preventDefaults).
 */
export function dispatchKeyEvent(e: KeyEventLike, doc: Document): boolean {
  const id = resolveCommand(e, false, doc);
  if (!id) return false;
  appStore.get(registryAtom)?.run(id);
  return true;
}

/** Viewport-scoped command id for a key event (ViewportInput applies gating). */
export function viewportScopedCommand(e: KeyEventLike): string | null {
  // viewport-scoped commands carry no `when` guard, so no doc is needed
  return resolveCommand(e, true, null);
}

/** Run a command by id through the active registry (respects enabled()). */
export function runCommandById(id: string): void {
  appStore.get(registryAtom)?.run(id);
}

// ---- edit-mode entry (shared by commands + ToolRail) -----------------------

/**
 * Enter an edit mode. Entering a component mode on a primitive converts it to
 * an editable mesh first (one undoable step) and records it as the last mode.
 */
export function enterEditMode(doc: Document, mode: EditMode): void {
  if (mode === "point" || mode === "edge" || mode === "polygon") {
    const active = doc.selection.active;
    if (active && ConvertToMeshCommand.eligible(doc, active)) {
      doc.history.run(new ConvertToMeshCommand(doc, active));
    }
    appStore.set(lastComponentModeAtom, mode);
  }
  doc.selection.setEditMode(mode);
}

/** Blender's Tab: object ↔ the last component mode used (default point). */
export function toggleEditMode(doc: Document): void {
  if (doc.selection.editMode === "object") {
    enterEditMode(doc, appStore.get(lastComponentModeAtom));
  } else {
    enterEditMode(doc, "object");
  }
}

// ---- custom-preset CRUD (no-ops on built-ins) ------------------------------

function updateCustom(id: string, fn: (p: KeyPreset) => KeyPreset): void {
  appStore.set(
    customKeyPresetsAtom,
    appStore.get(customKeyPresetsAtom).map((p) => (p.id === id ? fn(p) : p)),
  );
}

/** Copy a preset (built-in or custom) into an editable custom preset + activate. */
export function duplicatePreset(id: string): void {
  const src = appStore.get(allKeyPresetsAtom).find((p) => p.id === id) ?? BUILTIN_KEY_PRESETS[0]!;
  const resolved = resolvePreset(src);
  const copy: KeyPreset = {
    version: 1,
    id: uuidv7(),
    name: `${src.name} copy`,
    keys: resolved.keys.map((k) => ({ ...k })),
  };
  appStore.set(customKeyPresetsAtom, [...appStore.get(customKeyPresetsAtom), copy]);
  appStore.set(activeKeyPresetIdAtom, copy.id);
}

export function renamePreset(id: string, name: string): void {
  updateCustom(id, (p) => ({ ...p, name }));
}

export function deletePreset(id: string): void {
  appStore.set(
    customKeyPresetsAtom,
    appStore.get(customKeyPresetsAtom).filter((p) => p.id !== id),
  );
  if (appStore.get(activeKeyPresetIdAtom) === id) {
    appStore.set(activeKeyPresetIdAtom, DEFAULT_KEY_PRESET_ID);
  }
}

/** Bind a chord to a command; optionally clear whatever else holds that chord. */
export function bindKey(
  presetId: string,
  command: string,
  chord: string,
  replaceConflict = false,
): void {
  const canon = formatChord(parseChord(chord));
  updateCustom(presetId, (p) => {
    let keys = p.keys;
    if (replaceConflict) {
      keys = keys.filter((k) => formatChord(parseChord(k.chord)) !== canon);
    }
    if (keys.some((k) => k.command === command && formatChord(parseChord(k.chord)) === canon)) {
      return { ...p, keys };
    }
    return { ...p, keys: [...keys, { command, chord: canon }] };
  });
}

export function unbindKey(presetId: string, command: string, chord: string): void {
  const canon = formatChord(parseChord(chord));
  updateCustom(presetId, (p) => ({
    ...p,
    keys: p.keys.filter(
      (k) => !(k.command === command && formatChord(parseChord(k.chord)) === canon),
    ),
  }));
}

// ---- label hooks -----------------------------------------------------------

/** First chord label bound to a command in the active preset (for menus). */
export function useBindingLabel(command: string): string | null {
  const preset = useAtomValue(activeKeyPresetAtom);
  const chords = bindingsForCommand(preset, command);
  return chords.length ? chordLabel(chords[0]!, IS_MAC) : null;
}

/** Non-hook variant for loops (context menu): reads the active preset live. */
export function commandBindingLabel(command: string): string | null {
  const chords = bindingsForCommand(appStore.get(activeKeyPresetAtom), command);
  return chords.length ? chordLabel(chords[0]!, IS_MAC) : null;
}
