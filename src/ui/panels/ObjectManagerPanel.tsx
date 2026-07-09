import { useState } from "react";
import type { Uuid } from "@/types/core";
import { RenameNodeCommand, SetFlagsCommand } from "@/core/history/commands/scene";
import { useDocument } from "@/ui/hooks/DocumentContext";
import { useDocSlice } from "@/ui/hooks/useDocSlice";

const KIND_GLYPH: Record<string, string> = {
  null: "▢",
  mesh: "◆",
  spline: "∿",
  generator: "⚙",
  light: "✦",
  camera: "🎥",
};

/** Hierarchical object manager: select, expand, rename, visibility. */
export function ObjectManagerPanel() {
  const doc = useDocument();
  useDocSlice("scene");
  useDocSlice("selection");
  const [collapsed, setCollapsed] = useState<Set<Uuid>>(new Set());
  const [renaming, setRenaming] = useState<Uuid | null>(null);

  const toggleCollapse = (id: Uuid) => {
    const next = new Set(collapsed);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setCollapsed(next);
  };

  const rows: { id: Uuid; depth: number }[] = [];
  const walk = (id: Uuid, depth: number) => {
    rows.push({ id, depth });
    if (!collapsed.has(id)) for (const c of doc.scene.childrenOf(id)) walk(c, depth + 1);
  };
  for (const r of doc.scene.rootIds()) walk(r, 0);

  return (
    <div
      className="t-tree"
      style={{ height: "100%", overflow: "auto", background: "var(--t-bg-panel)" }}
    >
      {rows.map(({ id, depth }) => {
        const node = doc.scene.mustGet(id);
        const kids = doc.scene.childrenOf(id).length > 0;
        return (
          <div
            key={id}
            className="t-tree-row"
            data-selected={doc.selection.has(id)}
            style={{ paddingLeft: depth * 14 }}
            onPointerDown={(e) => {
              if (renaming === id) return;
              const op = e.shiftKey ? "add" : e.metaKey || e.ctrlKey ? "toggle" : "replace";
              doc.selection.selectObjects([id], op);
            }}
            onDoubleClick={() => setRenaming(id)}
          >
            <span
              className="t-tree-caret"
              onPointerDown={(e) => {
                e.stopPropagation();
                if (kids) toggleCollapse(id);
              }}
            >
              {kids ? (collapsed.has(id) ? "▶" : "▼") : ""}
            </span>
            <span
              style={{ width: 16, flex: "none", textAlign: "center", color: "var(--t-fg-dim)" }}
            >
              {KIND_GLYPH[node.kind] ?? "•"}
            </span>
            {renaming === id ? (
              <input
                autoFocus
                defaultValue={node.name}
                style={{
                  flex: 1,
                  background: "var(--t-bg-input)",
                  border: "1px solid var(--t-accent)",
                  color: "var(--t-fg)",
                  font: "inherit",
                }}
                onBlur={(e) => {
                  if (e.target.value && e.target.value !== node.name) {
                    doc.history.run(new RenameNodeCommand(id, e.target.value));
                  }
                  setRenaming(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                  if (e.key === "Escape") setRenaming(null);
                  e.stopPropagation();
                }}
              />
            ) : (
              <span className="t-tree-label">{node.name}</span>
            )}
            <span
              className="t-tree-vis"
              data-off={!node.visible}
              title="Toggle visibility"
              onPointerDown={(e) => {
                e.stopPropagation();
                doc.history.run(new SetFlagsCommand(id, { visible: !node.visible }));
              }}
            >
              {node.visible ? "●" : "○"}
            </span>
          </div>
        );
      })}
      {rows.length === 0 ? (
        <div style={{ padding: 12, color: "var(--t-fg-dim)" }}>
          Empty scene — add something from Create.
        </div>
      ) : null}
    </div>
  );
}
