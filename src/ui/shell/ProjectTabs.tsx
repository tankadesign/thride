import { useState } from "react";
import { IconClose } from "@/icons";
import type { Uuid } from "@/types/core";
import {
  closeProject,
  createProject,
  renameProject,
  switchProject,
  useProjects,
} from "@/ui/hooks/doc/projects";

/**
 * Open-project tabs, top level just below the menu bar: daisyUI small
 * tabs, horizontally scrollable when they overflow. Double-click a tab to
 * rename it inline (Enter or clicking anywhere commits, Escape cancels).
 * Closing a tab keeps the project stored in IndexedDB; the last tab
 * cannot close.
 */
export function ProjectTabs() {
  const { projects, activeId } = useProjects();
  const [editing, setEditing] = useState<{ id: Uuid; value: string } | null>(null);

  const commit = () => {
    if (!editing) return;
    renameProject(editing.id, editing.value);
    setEditing(null);
  };

  return (
    <div className="flex flex-none items-center gap-1 border-b border-base-100 bg-base-300 pr-1">
      <div
        role="tablist"
        className="tabs tabs-lift tabs-sm min-w-0 flex-1 flex-nowrap overflow-x-auto pt-1 pl-1 whitespace-nowrap [scrollbar-width:thin]"
      >
        {projects.map((p) => (
          <button
            key={p.id}
            type="button"
            role="tab"
            className={`tab flex-none gap-1.5 ${p.id === activeId ? "tab-active" : ""}`}
            onClick={() => switchProject(p.id)}
            onDoubleClick={() => setEditing({ id: p.id, value: p.name })}
          >
            {editing?.id === p.id ? (
              <input
                // biome-ignore lint/a11y/noAutofocus: inline rename — focus IS the interaction
                autoFocus
                className="input input-xs h-5 w-28 border-base-300 bg-base-100 px-1"
                value={editing.value}
                onFocus={(e) => e.currentTarget.select()}
                onChange={(e) => setEditing({ id: p.id, value: e.target.value })}
                onBlur={commit}
                onClick={(e) => e.stopPropagation()}
                onKeyDown={(e) => {
                  e.stopPropagation();
                  if (e.key === "Enter") commit();
                  if (e.key === "Escape") setEditing(null);
                }}
              />
            ) : (
              <span className="max-w-40 truncate">{p.name}</span>
            )}
            {projects.length > 1 && editing?.id !== p.id ? (
              <span
                className="cursor-pointer rounded-sm px-0.5 leading-none opacity-40 hover:bg-base-100 hover:text-error hover:opacity-100"
                onClick={(e) => {
                  e.stopPropagation();
                  closeProject(p.id);
                }}
                title="Close project"
              >
                <IconClose size={11} />
              </span>
            ) : null}
          </button>
        ))}
      </div>
      <button
        type="button"
        className="btn btn-ghost btn-sm btn-square flex-none text-lg leading-none"
        onClick={() => void createProject()}
        title="New project"
      >
        +
      </button>
    </div>
  );
}
