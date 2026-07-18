import { describe, expect, it } from "vite-plus/test";
import type { KeyPreset, ModifierSet, MouseCombo, NavPreset } from "@/types/keymap";
import {
  bindingsForCommand,
  buildKeyLookup,
  deriveMouseBindings,
  findConflicts,
  matchMouseBinding,
} from "./resolve";

const M = (p: Partial<ModifierSet> = {}): ModifierSet => ({
  ctrl: false,
  meta: false,
  alt: false,
  shift: false,
  ...p,
});
const combo = (button: 0 | 1 | 2, mods: Partial<ModifierSet> = {}): MouseCombo => ({
  button,
  mods: M(mods),
});

const C4D: NavPreset = {
  id: "c4d",
  name: "C4D",
  orbit: [combo(0, { alt: true })],
  pan: [combo(1, { alt: true }), combo(0, { meta: true })],
  dolly: [combo(2, { alt: true }), combo(0, { meta: true, alt: true })],
};
const THREEJS: NavPreset = {
  id: "threejs",
  name: "three.js",
  orbit: [combo(0)],
  pan: [combo(2)],
  dolly: [],
};
const BLENDER: NavPreset = {
  id: "blender",
  name: "Blender",
  orbit: [combo(1)],
  pan: [combo(1, { shift: true })],
  dolly: [combo(1, { ctrl: true })],
};

describe("deriveMouseBindings", () => {
  it("C4D: cmd+LMB is a deferred pan/select, cmd+alt+LMB is a pure dolly", () => {
    const b = deriveMouseBindings(C4D);
    const cmdL = matchMouseBinding(b, 0, M({ meta: true }));
    expect(cmdL).toMatchObject({ drag: "pan", click: "select" });
    const cmdAltL = matchMouseBinding(b, 0, M({ meta: true, alt: true }));
    expect(cmdAltL?.drag).toBe("dolly");
    expect(cmdAltL?.click).toBeUndefined();
    // plain LMB stays select-on-click with no drag
    const plainL = matchMouseBinding(b, 0, M());
    expect(plainL).toMatchObject({ click: "select" });
    expect(plainL?.drag).toBeUndefined();
    // plain MMB stays maximize; alt+MMB pans
    expect(matchMouseBinding(b, 1, M())).toMatchObject({ click: "maximizePane" });
    expect(matchMouseBinding(b, 1, M({ alt: true }))?.drag).toBe("pan");
  });

  it("ThreeJS: LMB defers orbit/select, RMB defers pan/context", () => {
    const b = deriveMouseBindings(THREEJS);
    expect(matchMouseBinding(b, 0, M())).toMatchObject({ drag: "orbit", click: "select" });
    expect(matchMouseBinding(b, 2, M())).toMatchObject({ drag: "pan", click: "contextMenu" });
  });

  it("Blender: MMB defers orbit/maximize, shift+MMB pan, ctrl+MMB dolly", () => {
    const b = deriveMouseBindings(BLENDER);
    expect(matchMouseBinding(b, 1, M())).toMatchObject({ drag: "orbit", click: "maximizePane" });
    expect(matchMouseBinding(b, 1, M({ shift: true }))?.drag).toBe("pan");
    expect(matchMouseBinding(b, 1, M({ ctrl: true }))?.drag).toBe("dolly");
    // LMB is plain select in Blender
    expect(matchMouseBinding(b, 0, M())).toMatchObject({ click: "select" });
  });
});

describe("matchMouseBinding fallback", () => {
  it("selection modifiers fall back to the button's no-mods binding", () => {
    const b = deriveMouseBindings(THREEJS);
    // shift+LMB has no exact combo → falls back to LMB (orbit/select)
    expect(matchMouseBinding(b, 0, M({ shift: true }))).toMatchObject({ click: "select" });
  });

  it("alt does NOT fall back (alt is a distinct nav modifier)", () => {
    const b = deriveMouseBindings(THREEJS);
    expect(matchMouseBinding(b, 0, M({ alt: true }))).toBeNull();
  });
});

describe("key lookup", () => {
  const preset: KeyPreset = {
    version: 1,
    id: "t",
    name: "T",
    keys: [
      { command: "edit.delete", chord: "delete" },
      { command: "edit.delete", chord: "backspace" },
      { command: "edit.undo", chord: "meta+z" },
      { command: "mode.point", chord: "1", when: "editMode" },
    ],
  };

  it("groups entries by canonical chord", () => {
    const lookup = buildKeyLookup(preset);
    expect(lookup.get("meta+z")?.[0].command).toBe("edit.undo");
    expect(lookup.get("delete")).toHaveLength(1);
  });

  it("bindingsForCommand returns every chord for a command", () => {
    expect(bindingsForCommand(preset, "edit.delete")).toHaveLength(2);
  });

  it("findConflicts flags a chord bound to two commands", () => {
    const conflicting: KeyPreset = {
      ...preset,
      keys: [
        { command: "a", chord: "k" },
        { command: "b", chord: "k" },
      ],
    };
    expect(findConflicts(conflicting)).toHaveLength(1);
    expect(findConflicts(preset)).toHaveLength(0);
  });
});
