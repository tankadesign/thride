import { useEffect, useMemo, useRef, useState } from "react";
import type { CommandRegistry } from "@/ui/commands/CommandRegistry";
import { shortcutLabel } from "@/ui/commands/CommandRegistry";
import { IconSearch } from "@/icons";

interface Props {
  registry: CommandRegistry;
  onClose: () => void;
}

/** ⌘K command palette — daisyUI modal + compact menu list. */
export function CommandPalette({ registry, onClose }: Props) {
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    const all = registry.all().filter((c) => c.enabled?.() ?? true);
    if (!q) return all.slice(0, 40);
    return all
      .map((c) => ({ c, score: score(c.title.toLowerCase(), q) }))
      .filter((m) => m.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 40)
      .map((m) => m.c);
  }, [registry, query]);

  useEffect(() => inputRef.current?.focus(), []);

  const runSelected = () => {
    const cmd = matches[index];
    if (cmd) {
      onClose();
      cmd.run();
    }
  };

  return (
    <div className="modal modal-open modal-top" onPointerDown={onClose}>
      <div
        className="modal-box mx-auto mt-[12vh] w-[30rem] max-w-full p-0"
        onPointerDown={(e) => e.stopPropagation()}
      >
        <label className="input input-sm input-ghost w-full rounded-none border-0 border-b border-base-300">
          <IconSearch className="opacity-50" />
          <input
            ref={inputRef}
            placeholder="Type a command…"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setIndex(0);
            }}
            onKeyDown={(e) => {
              if (e.key === "Escape") onClose();
              if (e.key === "Enter") runSelected();
              if (e.key === "ArrowDown") setIndex((i) => Math.min(i + 1, matches.length - 1));
              if (e.key === "ArrowUp") setIndex((i) => Math.max(i - 1, 0));
              e.stopPropagation();
            }}
          />
        </label>
        <ul className="menu menu-xs max-h-[45vh] w-full flex-nowrap overflow-y-auto p-1">
          {matches.map((cmd, i) => (
            <li key={cmd.id}>
              <button
                type="button"
                className={`flex justify-between gap-6 ${i === index ? "menu-active" : ""}`}
                onPointerEnter={() => setIndex(i)}
                onPointerDown={() => {
                  setIndex(i);
                  runSelected();
                }}
              >
                <span>
                  {cmd.menu ? <span className="opacity-50">{cmd.menu} › </span> : null}
                  {cmd.title}
                </span>
                {cmd.shortcut ? (
                  <kbd className="kbd kbd-xs opacity-60">{shortcutLabel(cmd.shortcut)}</kbd>
                ) : null}
              </button>
            </li>
          ))}
          {matches.length === 0 ? (
            <li className="menu-disabled">
              <span>No matching commands</span>
            </li>
          ) : null}
        </ul>
      </div>
    </div>
  );
}

/** crude subsequence scorer — consecutive matches beat scattered ones */
function score(text: string, q: string): number {
  if (text.includes(q)) return 100 - text.indexOf(q);
  let ti = 0;
  let s = 0;
  for (const ch of q) {
    const found = text.indexOf(ch, ti);
    if (found === -1) return 0;
    s += found === ti ? 3 : 1;
    ti = found + 1;
  }
  return s;
}
