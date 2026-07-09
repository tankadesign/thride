import { useEffect, useMemo, useRef, useState } from "react";
import type { CommandRegistry } from "@/ui/commands/CommandRegistry";
import { shortcutLabel } from "@/ui/commands/CommandRegistry";

interface Props {
  registry: CommandRegistry;
  onClose: () => void;
}

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
  useEffect(() => setIndex(0), []);

  const runSelected = () => {
    const cmd = matches[index];
    if (cmd) {
      onClose();
      cmd.run();
    }
  };

  return (
    <div className="t-palette-overlay" onPointerDown={onClose}>
      <div className="t-palette" onPointerDown={(e) => e.stopPropagation()}>
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
        <div className="t-palette-list">
          {matches.map((cmd, i) => (
            <div
              key={cmd.id}
              className="t-palette-item"
              data-active={i === index}
              onPointerEnter={() => setIndex(i)}
              onPointerDown={() => {
                setIndex(i);
                runSelected();
              }}
            >
              <span>
                {cmd.menu ? <span style={{ color: "var(--t-fg-dim)" }}>{cmd.menu} › </span> : null}
                {cmd.title}
              </span>
              {cmd.shortcut ? (
                <span className="t-menu-shortcut">{shortcutLabel(cmd.shortcut)}</span>
              ) : null}
            </div>
          ))}
          {matches.length === 0 ? (
            <div className="t-palette-item" style={{ color: "var(--t-fg-dim)" }}>
              No matching commands
            </div>
          ) : null}
        </div>
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
