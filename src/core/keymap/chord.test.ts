import { describe, expect, it } from "vite-plus/test";
import type { KeyEventLike } from "@/types/keymap";
import {
  chordFromEvent,
  chordLabel,
  comboLabel,
  expandMod,
  formatChord,
  hasCmdOrCtrl,
  parseChord,
} from "./chord";

function ev(partial: Partial<KeyEventLike>): KeyEventLike {
  return {
    key: "",
    code: "",
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    shiftKey: false,
    ...partial,
  };
}

describe("chordFromEvent", () => {
  it("derives letters from e.code, not e.key (mac alt-letter safe)", () => {
    // macOS Alt+K yields e.key === "˚"; the code is what makes it bindable.
    const c = chordFromEvent(ev({ key: "˚", code: "KeyK", altKey: true }));
    expect(c).toEqual({ key: "k", ctrl: false, meta: false, alt: true, shift: false });
  });

  it("derives digits from e.code so Shift+1 stays '1'", () => {
    const c = chordFromEvent(ev({ key: "!", code: "Digit1", shiftKey: true }));
    expect(c?.key).toBe("1");
    expect(c?.shift).toBe(true);
  });

  it("uses lowercased e.key for named keys", () => {
    expect(chordFromEvent(ev({ key: "Tab", code: "Tab" }))?.key).toBe("tab");
    expect(chordFromEvent(ev({ key: "Escape", code: "Escape" }))?.key).toBe("escape");
    expect(chordFromEvent(ev({ key: " ", code: "Space" }))?.key).toBe("space");
  });

  it("returns null for a bare modifier press", () => {
    expect(chordFromEvent(ev({ key: "Shift", code: "ShiftLeft", shiftKey: true }))).toBeNull();
    expect(chordFromEvent(ev({ key: "Meta", code: "MetaLeft", metaKey: true }))).toBeNull();
  });
});

describe("parse/format round-trip", () => {
  it("canonicalizes modifier order", () => {
    expect(formatChord(parseChord("shift+ctrl+alt+k"))).toBe("ctrl+alt+shift+k");
    expect(formatChord(parseChord("meta+z"))).toBe("meta+z");
    expect(formatChord(parseChord("tab"))).toBe("tab");
  });
});

describe("expandMod", () => {
  it("maps mod → meta on mac, ctrl elsewhere", () => {
    expect(expandMod("mod+z", true)).toBe("meta+z");
    expect(expandMod("shift+mod+z", false)).toBe("shift+ctrl+z");
    expect(expandMod("f", true)).toBe("f");
  });
});

describe("hasCmdOrCtrl", () => {
  it("is true only when ctrl or meta is set", () => {
    expect(hasCmdOrCtrl(parseChord("meta+z"))).toBe(true);
    expect(hasCmdOrCtrl(parseChord("ctrl+z"))).toBe(true);
    expect(hasCmdOrCtrl(parseChord("shift+a"))).toBe(false);
    expect(hasCmdOrCtrl(parseChord("a"))).toBe(false);
  });
});

describe("labels", () => {
  it("renders a mac glyph run and a windows join", () => {
    const c = parseChord("ctrl+shift+alt+k");
    expect(chordLabel(c, true)).toBe("⌃⌥⇧K");
    expect(chordLabel(c, false)).toBe("Ctrl+Alt+Shift+K");
    expect(chordLabel(parseChord("meta+z"), true)).toBe("⌘Z");
  });

  it("labels mouse combos with button + modifiers", () => {
    expect(comboLabel({ button: 1, mods: parseChord("alt+x") }, false)).toBe("Alt+Middle-drag");
    expect(comboLabel({ button: 0, mods: parseChord("x") }, true)).toBe("Left-drag");
  });
});
