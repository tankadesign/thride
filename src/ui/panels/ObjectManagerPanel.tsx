import { useRef, useState } from "react";
import type { Uuid } from "@/types/core";
import {
  RenameNodeCommand,
  ReparentNodeCommand,
  SetFlagsCommand,
} from "@/core/history/commands/scene";
import { useDocument, useSliceVersion } from "@/ui/hooks/doc/document";
import { useSelectionInfo } from "@/ui/hooks/doc/selection";
import { openContextMenu } from "@/ui/hooks/editor/shell";
import {
  IconCamera,
  IconCollapse,
  IconCube,
  IconExpand,
  IconEye,
  IconEyeOff,
  IconGenerator,
  IconLight,
  IconNull,
  IconSpline,
} from "@/icons";

const ROW_H = 24;
const INDENT = 14;

const KIND_ICON: Record<string, React.ReactNode> = {
  null: <IconNull size={14} className="opacity-60" />,
  mesh: <IconCube size={14} className="opacity-60" />,
  spline: <IconSpline size={14} className="opacity-60" />,
  generator: <IconGenerator size={14} className="opacity-60" />,
  light: <IconLight size={14} className="opacity-60" />,
  camera: <IconCamera size={14} className="opacity-60" />,
};

const CONTEXT_COMMANDS = ["edit.group", "edit.convertToMesh", "edit.delete", "edit.deselect"];

interface Row {
  id: Uuid;
  depth: number;
}

interface DropTarget {
  rowIndex: number;
  mode: "before" | "after" | "inside";
}

/**
 * Hierarchical object manager: select, expand/collapse (⌘ = deep), rename,
 * visibility, right-click context menu, and drag-and-drop nesting with a
 * dotted drop-position indicator.
 */
export function ObjectManagerPanel() {
  const doc = useDocument();
  useSliceVersion("scene");
  useSelectionInfo();
  const [collapsed, setCollapsed] = useState<Set<Uuid>>(new Set());
  const [renaming, setRenaming] = useState<Uuid | null>(null);
  const [dropTarget, setDropTarget] = useState<DropTarget | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ id: Uuid; startX: number; startY: number; active: boolean } | null>(
    null,
  );

  // ---- rows (flattened visible tree) ----
  const rows: Row[] = [];
  const walk = (id: Uuid, depth: number) => {
    rows.push({ id, depth });
    if (!collapsed.has(id)) for (const c of doc.scene.childrenOf(id)) walk(c, depth + 1);
  };
  for (const r of doc.scene.rootIds()) walk(r, 0);

  // ---- collapse/expand (⌘-click = whole subtree) ----
  const descendants = (id: Uuid, out: Uuid[] = []): Uuid[] => {
    for (const c of doc.scene.childrenOf(id)) {
      out.push(c);
      descendants(c, out);
    }
    return out;
  };
  const toggleCollapse = (id: Uuid, deep: boolean) => {
    const next = new Set(collapsed);
    const closing = !next.has(id);
    const targets = deep ? [id, ...descendants(id)] : [id];
    for (const t of targets) {
      if (closing) next.add(t);
      else next.delete(t);
    }
    setCollapsed(next);
  };

  // ---- drag & drop nesting ----
  const draggedIdsFor = (id: Uuid | undefined): Uuid[] => {
    if (!id) return [];
    if (!doc.selection.has(id)) return [id];
    return doc.selection.objectIds.filter(
      (a) =>
        doc.scene.has(a) &&
        !doc.selection.objectIds.some((b) => b !== a && doc.scene.isAncestorOrSelf(b, a)),
    );
  };

  const targetFromEvent = (e: React.PointerEvent): DropTarget | null => {
    const el = containerRef.current;
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    const y = e.clientY - rect.top + el.scrollTop;
    const rowIndex = Math.min(rows.length - 1, Math.max(0, Math.floor(y / ROW_H)));
    if (rows.length === 0) return null;
    const within = y - rowIndex * ROW_H;
    const mode: DropTarget["mode"] =
      within < ROW_H * 0.25 ? "before" : within > ROW_H * 0.75 ? "after" : "inside";
    const target = rows[rowIndex]!;
    // no dropping into a dragged subtree
    if (draggedIdsFor(dragRef.current?.id).some((d) => doc.scene.isAncestorOrSelf(d, target.id))) {
      return null;
    }
    return { rowIndex, mode };
  };

  const onRowPointerDown = (e: React.PointerEvent, id: Uuid) => {
    if (e.button !== 0 || renaming === id) return;
    dragRef.current = { id, startX: e.clientX, startY: e.clientY, active: false };
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d) return;
    if (!d.active && Math.hypot(e.clientX - d.startX, e.clientY - d.startY) > 5) {
      d.active = true;
      if (!doc.selection.has(d.id)) doc.selection.selectObjects([d.id]);
      containerRef.current?.setPointerCapture(e.pointerId);
    }
    if (d.active) setDropTarget(targetFromEvent(e));
  };

  const onPointerUp = () => {
    const d = dragRef.current;
    dragRef.current = null;
    if (!d?.active) {
      setDropTarget(null);
      return;
    }
    const target = dropTarget;
    setDropTarget(null);
    if (!target) return;
    const ids = draggedIdsFor(d.id);
    const targetRow = rows[target.rowIndex];
    if (!targetRow || ids.length === 0) return;

    let parent: Uuid | null;
    let index: number | undefined;
    if (target.mode === "inside") {
      parent = targetRow.id;
      index = undefined; // append
      setCollapsed((prev) => {
        const next = new Set(prev);
        next.delete(targetRow.id); // reveal the drop
        return next;
      });
    } else {
      parent = doc.scene.mustGet(targetRow.id).parent;
      const siblings = doc.scene.childrenOf(parent);
      index = siblings.indexOf(targetRow.id) + (target.mode === "after" ? 1 : 0);
    }
    doc.history.transact("Move Objects", () => {
      for (const id of ids) {
        doc.history.run(new ReparentNodeCommand(id, parent, index));
        if (index !== undefined) index++;
      }
    });
  };

  const onRowContextMenu = (e: React.MouseEvent, id: Uuid) => {
    e.preventDefault();
    if (!doc.selection.has(id)) doc.selection.selectObjects([id]);
    openContextMenu({ x: e.clientX, y: e.clientY, commandIds: CONTEXT_COMMANDS });
  };

  // dotted indicator geometry
  const indicator = (() => {
    if (!dropTarget) return null;
    const row = rows[dropTarget.rowIndex];
    if (!row) return null;
    if (dropTarget.mode === "inside") return null; // row highlight instead
    const y = dropTarget.rowIndex * ROW_H + (dropTarget.mode === "after" ? ROW_H : 0);
    return { y, depth: row.depth };
  })();

  return (
    <div
      ref={containerRef}
      className="relative h-full overflow-auto bg-base-100 text-xs select-none"
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerLeave={() => dragRef.current?.active && setDropTarget(null)}
    >
      {rows.map(({ id, depth }, rowIndex) => {
        const node = doc.scene.mustGet(id);
        const kids = doc.scene.childrenOf(id).length > 0;
        const selected = doc.selection.has(id);
        const isInsideTarget = dropTarget?.mode === "inside" && dropTarget.rowIndex === rowIndex;
        return (
          <div
            key={id}
            className={`flex items-center gap-1 pr-1 ${
              selected ? "bg-primary/25" : "hover:bg-base-200"
            } ${isInsideTarget ? "outline outline-1 outline-dashed outline-primary" : ""}`}
            style={{ paddingLeft: depth * INDENT + 2, height: ROW_H }}
            onPointerDown={(e) => onRowPointerDown(e, id)}
            onClick={(e) => {
              if (renaming === id || dragRef.current?.active) return;
              const op = e.shiftKey ? "add" : e.metaKey || e.ctrlKey ? "toggle" : "replace";
              doc.selection.selectObjects([id], op);
            }}
            onDoubleClick={() => setRenaming(id)}
            onContextMenu={(e) => onRowContextMenu(e, id)}
          >
            <button
              type="button"
              className={`btn btn-ghost btn-xs h-4 min-h-0 w-4 p-0 ${kids ? "" : "invisible"}`}
              title="Expand/collapse (⌘-click: whole subtree)"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                toggleCollapse(id, e.metaKey || e.ctrlKey);
              }}
            >
              {collapsed.has(id) ? <IconExpand size={13} /> : <IconCollapse size={13} />}
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
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                doc.history.run(new SetFlagsCommand(id, { visible: !node.visible }));
              }}
            >
              {node.visible ? (
                <IconEye size={14} />
              ) : (
                <IconEyeOff size={14} className="text-error" />
              )}
            </button>
          </div>
        );
      })}
      {indicator ? (
        <div
          className="pointer-events-none absolute right-1 border-t-2 border-dashed border-primary"
          style={{ top: indicator.y - 1, left: indicator.depth * INDENT + 6 }}
        />
      ) : null}
      {rows.length === 0 ? (
        <div className="p-3 opacity-50">Empty scene — add something from Create.</div>
      ) : null}
    </div>
  );
}
