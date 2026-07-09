import { useState } from "react";
import type { Uuid } from "@/types/core";
import { RenameNodeCommand, SetFlagsCommand } from "@/core/history/commands/scene";
import { useDocument, useSliceVersion } from "@/ui/hooks/doc/document";
import { useSelectionInfo } from "@/ui/hooks/doc/selection";
import {
  IconCamera,
  IconCube,
  IconEye,
  IconEyeOff,
  IconGenerator,
  IconLight,
  IconNull,
  IconSpline,
} from "@/icons";

const KIND_ICON: Record<string, React.ReactNode> = {
  null: <IconNull className="opacity-60" />,
  mesh: <IconCube className="opacity-60" />,
  spline: <IconSpline className="opacity-60" />,
  generator: <IconGenerator className="opacity-60" />,
  light: <IconLight className="opacity-60" />,
  camera: <IconCamera className="opacity-60" />,
};

/** Hierarchical object manager: select, expand, rename, visibility. */
export function ObjectManagerPanel() {
  const doc = useDocument();
  useSliceVersion("scene");
  useSelectionInfo();
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
    <div className="h-full overflow-auto bg-base-100 text-xs select-none">
      {rows.map(({ id, depth }) => {
        const node = doc.scene.mustGet(id);
        const kids = doc.scene.childrenOf(id).length > 0;
        const selected = doc.selection.has(id);
        return (
          <div
            key={id}
            className={`flex h-6 items-center gap-1 pr-1 ${
              selected ? "bg-primary/25" : "hover:bg-base-200"
            }`}
            style={{ paddingLeft: depth * 14 + 2 }}
            onClick={(e) => {
              if (renaming === id) return;
              const op = e.shiftKey ? "add" : e.metaKey || e.ctrlKey ? "toggle" : "replace";
              doc.selection.selectObjects([id], op);
            }}
            onDoubleClick={() => setRenaming(id)}
          >
            <button
              type="button"
              className={`btn btn-ghost btn-xs h-4 min-h-0 w-4 p-0 text-[9px] ${kids ? "" : "invisible"}`}
              onClick={(e) => {
                e.stopPropagation();
                toggleCollapse(id);
              }}
            >
              {collapsed.has(id) ? "▶" : "▼"}
            </button>
            {KIND_ICON[node.kind] ?? null}
            {renaming === id ? (
              <input
                autoFocus
                defaultValue={node.name}
                className="input input-xs input-primary h-5 flex-1 px-1"
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
              <span className={`flex-1 truncate ${node.visible ? "" : "opacity-40"}`}>
                {node.name}
              </span>
            )}
            <button
              type="button"
              className="btn btn-ghost btn-xs h-5 min-h-0 w-5 p-0"
              title="Toggle visibility"
              onClick={(e) => {
                e.stopPropagation();
                doc.history.run(new SetFlagsCommand(id, { visible: !node.visible }));
              }}
            >
              {node.visible ? <IconEye /> : <IconEyeOff className="text-error" />}
            </button>
          </div>
        );
      })}
      {rows.length === 0 ? (
        <div className="p-3 opacity-50">Empty scene — add something from Create.</div>
      ) : null}
    </div>
  );
}
