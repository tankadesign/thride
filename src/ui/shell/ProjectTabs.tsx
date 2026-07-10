import { closeProject, createProject, switchProject, useProjects } from "@/ui/hooks/doc/projects";

/**
 * Open-project tabs, top level just below the menu bar: daisyUI small
 * tabs, horizontally scrollable when they overflow. Closing a tab keeps
 * the project stored in IndexedDB; the last tab cannot close.
 */
export function ProjectTabs() {
  const { projects, activeId } = useProjects();
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
          >
            <span className="max-w-40 truncate">{p.name}</span>
            {projects.length > 1 ? (
              <span
                className="cursor-pointer rounded-sm px-0.5 leading-none opacity-40 hover:bg-base-100 hover:text-error hover:opacity-100"
                onClick={(e) => {
                  e.stopPropagation();
                  closeProject(p.id);
                }}
                title="Close project"
              >
                ✕
              </span>
            ) : null}
          </button>
        ))}
      </div>
      <button
        type="button"
        className="btn btn-ghost btn-xs btn-square flex-none"
        onClick={() => void createProject()}
        title="New project"
      >
        +
      </button>
    </div>
  );
}
