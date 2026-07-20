import { useState } from "react";
import { useAtom, useAtomValue } from "jotai";
import { comboLabel } from "@/core/keymap/chord";
import type { MouseCombo, NavAction } from "@/types/keymap";
import { NAV_PRESETS } from "@/ui/commands/presets";
import {
  activeKeyPresetAtom,
  activeKeyPresetIdAtom,
  activeNavPresetAtom,
  activeNavPresetIdAtom,
  allKeyPresetsAtom,
  deletePreset,
  duplicatePreset,
  IS_MAC,
  renamePreset,
} from "@/ui/hooks/editor/keymap";
import { KeyBindingList } from "./KeyBindingList";
import { useKeyCapture } from "./useKeyCapture";

export function KeyBindingsPanel() {
  return (
    <div className="flex h-full flex-col gap-3 overflow-y-auto bg-base-200 p-3 text-sm">
      <NavSection />
      <KeysSection />
    </div>
  );
}

function NavSection() {
  const [navId, setNavId] = useAtom(activeNavPresetIdAtom);
  const nav = useAtomValue(activeNavPresetAtom);
  const rows: { action: NavAction; label: string; combos: MouseCombo[] }[] = [
    { action: "orbit", label: "Orbit", combos: nav.orbit },
    { action: "pan", label: "Pan", combos: nav.pan },
    { action: "dolly", label: "Dolly", combos: nav.dolly },
  ];
  return (
    <section className="flex flex-col gap-1.5">
      <h3 className="font-semibold">Navigation</h3>
      <select
        className="select select-sm w-full"
        value={navId}
        onChange={(e) => setNavId(e.target.value)}
      >
        {NAV_PRESETS.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </select>
      <div className="rounded-box border border-base-300 p-2 text-xs">
        {rows.map((r) => (
          <div key={r.action} className="flex items-baseline gap-2 py-0.5">
            <span className="w-12 shrink-0 text-base-content/60">{r.label}</span>
            <span className="flex flex-wrap gap-1">
              {r.combos.map((c, i) => (
                <kbd key={i} className="kbd kbd-sm">
                  {comboLabel(c, IS_MAC)}
                </kbd>
              ))}
              {r.action === "dolly" ? <kbd className="kbd kbd-sm">Scroll wheel</kbd> : null}
              {r.combos.length === 0 && r.action !== "dolly" ? (
                <span className="text-base-content/40">—</span>
              ) : null}
            </span>
          </div>
        ))}
        <p className="mt-1 border-t border-base-300 pt-1 text-base-content/50">
          Click: left selects · right opens the menu · middle maximizes the pane.
        </p>
      </div>
    </section>
  );
}

function KeysSection() {
  const [keyId, setKeyId] = useAtom(activeKeyPresetIdAtom);
  const presets = useAtomValue(allKeyPresetsAtom);
  const active = useAtomValue(activeKeyPresetAtom);
  const editable = !active.builtin;
  const capture = useKeyCapture(keyId);
  const [renaming, setRenaming] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const builtins = presets.filter((p) => p.builtin);
  const customs = presets.filter((p) => !p.builtin);

  return (
    <section className="flex min-h-0 flex-1 flex-col gap-1.5">
      <h3 className="font-semibold">Keyboard shortcuts</h3>
      <div className="flex items-center gap-1">
        {renaming && editable ? (
          <input
            autoFocus
            className="input input-md flex-1"
            defaultValue={active.name}
            onBlur={(e) => {
              renamePreset(keyId, e.target.value.trim() || active.name);
              setRenaming(false);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") (e.target as HTMLInputElement).blur();
              if (e.key === "Escape") setRenaming(false);
              e.stopPropagation();
            }}
          />
        ) : (
          <select
            className="select select-sm flex-1"
            value={keyId}
            onChange={(e) => setKeyId(e.target.value)}
          >
            <optgroup label="Built-in">
              {builtins.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </optgroup>
            {customs.length > 0 ? (
              <optgroup label="Custom">
                {customs.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </optgroup>
            ) : null}
          </select>
        )}
        {!editable ? (
          <span className="ml-2 badge badge-sm badge-outline badge-warning">Read only</span>
        ) : null}
        <button
          type="button"
          className="btn btn-xs btn-link"
          onClick={() => duplicatePreset(keyId)}
        >
          Duplicate
        </button>
        {editable ? (
          <button
            type="button"
            className="btn btn-xs btn-secondary btn-link"
            onClick={() => setRenaming((r) => !r)}
          >
            Rename
          </button>
        ) : null}
        {editable ? (
          confirmDelete ? (
            <button
              type="button"
              className="btn btn-xs btn-accent"
              onClick={() => {
                deletePreset(keyId);
                setConfirmDelete(false);
              }}
            >
              Sure?
            </button>
          ) : (
            <button
              type="button"
              className="btn btn-xs btn-accent btn-link"
              onClick={() => setConfirmDelete(true)}
            >
              Delete
            </button>
          )
        ) : null}
      </div>

      <KeyBindingList presetId={keyId} editable={editable} capture={capture} />
    </section>
  );
}
