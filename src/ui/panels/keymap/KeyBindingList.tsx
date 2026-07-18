import { useMemo, useState } from "react";
import { useAtomValue } from "jotai";
import { chordLabel, formatChord } from "@/core/keymap/chord";
import { bindingsForCommand } from "@/core/keymap/resolve";
import type { AppCommand, MenuId } from "@/ui/commands/CommandRegistry";
import { activeKeyPresetAtom, IS_MAC, unbindKey } from "@/ui/hooks/editor/keymap";
import { useRegistry } from "@/ui/hooks/editor/shell";
import { IconClose, IconSearch } from "@/icons";
import type { useKeyCapture } from "./useKeyCapture";

const GROUP_ORDER: (MenuId | "Other")[] = ["File", "Edit", "Create", "Mesh", "View", "Other"];

interface Props {
  presetId: string;
  editable: boolean;
  capture: ReturnType<typeof useKeyCapture>;
}

export function KeyBindingList({ presetId, editable, capture }: Props) {
  const registry = useRegistry();
  const preset = useAtomValue(activeKeyPresetAtom);
  const [query, setQuery] = useState("");

  const groups = useMemo(() => {
    const all = registry?.all() ?? [];
    const q = query.trim().toLowerCase();
    const matched = q
      ? all.filter((c) => c.title.toLowerCase().includes(q) || c.id.toLowerCase().includes(q))
      : all;
    const byGroup = new Map<MenuId | "Other", AppCommand[]>();
    for (const cmd of matched) {
      const key = cmd.menu ?? "Other";
      const arr = byGroup.get(key);
      if (arr) arr.push(cmd);
      else byGroup.set(key, [cmd]);
    }
    return GROUP_ORDER.map((g) => ({ group: g, items: byGroup.get(g) ?? [] })).filter(
      (g) => g.items.length > 0,
    );
  }, [registry, query]);

  return (
    <div className="flex min-h-0 flex-col gap-1">
      <label className="input input-md w-full">
        <IconSearch className="opacity-50" size={14} />
        <input
          type="search"
          placeholder="Search commands…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </label>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {groups.map(({ group, items }) => (
          <div key={group}>
            <div className="sticky top-0 bg-base-200 z-1 px-1 py-2 text-[0.65rem] font-semibold tracking-wide text-base-content/50 uppercase">
              {group}
            </div>
            <ul className="menu menu-xs w-full p-0">
              {items.map((cmd) => (
                <Row
                  key={cmd.id}
                  cmd={cmd}
                  chords={bindingsForCommand(preset, cmd.id)}
                  guard={preset.keys.find((k) => k.command === cmd.id)?.when}
                  presetId={presetId}
                  editable={editable}
                  capture={capture}
                />
              ))}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
}

function Row({
  cmd,
  chords,
  guard,
  presetId,
  editable,
  capture,
}: {
  cmd: AppCommand;
  chords: ReturnType<typeof bindingsForCommand>;
  guard: string | undefined;
  presetId: string;
  editable: boolean;
  capture: ReturnType<typeof useKeyCapture>;
}) {
  const recording = capture.recordingCommand === cmd.id;
  return (
    <li>
      <div className="flex items-center gap-2 py-0.5">
        <span className="flex w-4 justify-center opacity-80">{cmd.icon}</span>
        <span className="flex-1 truncate">
          {cmd.title}
          {guard === "editMode" ? (
            <span className="ml-1 text-[0.65rem] text-base-content/40">edit mode</span>
          ) : null}
        </span>
        <div className="flex items-center gap-1">
          {chords.map((c) => {
            const chord = formatChord(c);
            return (
              <span key={chord} className="badge badge-sm gap-0.5 font-mono">
                {chordLabel(c, IS_MAC)}
                {editable ? (
                  <button
                    type="button"
                    className="opacity-50 hover:opacity-100"
                    title="Unbind"
                    onClick={() => unbindKey(presetId, cmd.id, chord)}
                  >
                    <IconClose size={10} />
                  </button>
                ) : null}
              </span>
            );
          })}
          {recording ? (
            capture.conflict ? (
              <span className="flex items-center gap-1 text-warning">
                <span className="text-[0.7rem]">bound elsewhere</span>
                <button
                  type="button"
                  className="btn btn-xs btn-warning"
                  onClick={capture.replaceConflict}
                >
                  Replace
                </button>
                <button type="button" className="btn btn-xs btn-ghost" onClick={capture.stop}>
                  Cancel
                </button>
              </span>
            ) : (
              <button type="button" className="btn btn-xs btn-primary" onClick={capture.stop}>
                Press keys… (Esc)
              </button>
            )
          ) : editable ? (
            <button
              type="button"
              className="btn btn-xs btn-ghost opacity-60 hover:opacity-100"
              onClick={() => capture.start(cmd.id)}
            >
              + Record
            </button>
          ) : null}
        </div>
      </div>
    </li>
  );
}
