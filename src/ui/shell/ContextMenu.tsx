import { useEffect } from "react";
import { shortcutLabel } from "@/ui/commands/CommandRegistry";
import { type MenuEntry, useContextMenu, useRegistry } from "@/ui/hooks/editor/shell";

/**
 * App-wide right-click context menu rendering a MenuEntry tree: leading
 * 16px icons, hover-flyout submenus, separators, radio-active rows.
 * commandId entries resolve against the registry. Closes on run/click-away/Esc.
 */
export function ContextMenu() {
  const { menu, close } = useContextMenu();

  useEffect(() => {
    if (!menu) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    window.addEventListener("keydown", onKey);
    window.addEventListener("blur", close);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("blur", close);
    };
  }, [menu, close]);

  if (!menu) return null;
  const width = 232;
  const x = Math.min(menu.x, window.innerWidth - width - 8);
  const y = Math.min(menu.y, window.innerHeight - menu.entries.length * 26 - 16);

  return (
    <div
      className="fixed inset-0 z-[1500]"
      onPointerDown={close}
      onContextMenu={(e) => e.preventDefault()}
    >
      <div
        style={{ position: "fixed", left: x, top: y }}
        onPointerDown={(e) => e.stopPropagation()}
      >
        <EntryList entries={menu.entries} close={close} width={width} />
      </div>
    </div>
  );
}

function EntryList({
  entries,
  close,
  width,
}: {
  entries: MenuEntry[];
  close: () => void;
  width: number;
}) {
  const registry = useRegistry();
  return (
    <ul
      className="menu menu-xs rounded-box border border-base-300 bg-base-200 shadow-lg"
      style={{ width }}
    >
      {entries.map((entry, i) => {
        const cmd = entry.commandId ? registry?.get(entry.commandId) : undefined;
        const label = entry.label ?? cmd?.title ?? "";
        const enabled = !entry.disabled && (cmd ? (cmd.enabled?.() ?? true) : true);
        const icon = entry.icon ?? cmd?.icon;
        const run = entry.run ?? cmd?.run;
        const shortcut = cmd?.shortcut;

        if (entry.children) {
          return (
            <li key={i} className={`group/sub relative ${enabled ? "" : "menu-disabled"}`}>
              {entry.sep ? <span className="mx-0 my-0.5 block h-px bg-base-300 p-0" /> : null}
              <span className="flex items-center gap-2">
                <span className="flex w-4 justify-center">{icon}</span>
                <span className="flex-1">{label}</span>
                <span className="opacity-50">›</span>
              </span>
              <div className="invisible absolute top-0 left-full z-10 pl-0.5 group-hover/sub:visible">
                <EntryList entries={entry.children} close={close} width={width} />
              </div>
            </li>
          );
        }

        return (
          <li key={i} className={enabled ? "" : "menu-disabled"}>
            {entry.sep ? <span className="mx-0 my-0.5 block h-px bg-base-300 p-0" /> : null}
            <button
              type="button"
              className={`flex items-center gap-2 ${entry.active ? "menu-active" : ""}`}
              onClick={() => {
                close();
                if (enabled) run?.();
              }}
            >
              <span className="flex w-4 justify-center">{icon}</span>
              <span className="flex-1 text-left">{label}</span>
              {shortcut ? (
                <kbd className="kbd kbd-xs opacity-60">{shortcutLabel(shortcut)}</kbd>
              ) : null}
            </button>
          </li>
        );
      })}
    </ul>
  );
}
