import type { AppCommand, CommandRegistry, MenuId } from "@/ui/commands/CommandRegistry";
import { shortcutLabel } from "@/ui/commands/CommandRegistry";
import { useHistoryInfo } from "@/ui/hooks/doc/history";
import { useSelectionInfo } from "@/ui/hooks/doc/selection";

const MENUS: MenuId[] = ["File", "Edit", "Create", "View", "Help"];

function MenuItem({ cmd }: { cmd: AppCommand }) {
  const enabled = cmd.enabled?.() ?? true;
  return (
    <li className={enabled ? "" : "menu-disabled"}>
      {cmd.sep ? <span className="mx-0 my-0.5 block h-px bg-base-300 p-0" /> : null}
      <button
        type="button"
        className="flex items-center gap-2"
        onClick={(e) => {
          (e.currentTarget.closest("[popover]") as HTMLElement | null)?.hidePopover();
          cmd.run();
        }}
      >
        <span className="flex w-4 justify-center">{cmd.icon}</span>
        <span className="flex-1 text-left">{cmd.title}</span>
        {cmd.shortcut ? (
          <kbd className="kbd kbd-xs opacity-60">{shortcutLabel(cmd.shortcut)}</kbd>
        ) : null}
      </button>
    </li>
  );
}

/**
 * Top menu bar built on the daisyUI megamenu (popover API): each top-level
 * button opens a popover containing a compact daisyUI menu of commands.
 */
export function MenuBar({ registry }: { registry: CommandRegistry }) {
  // menu item enabled() states depend on history + selection
  useHistoryInfo();
  useSelectionInfo();

  return (
    <div className="flex h-9 flex-none items-center gap-2 border-b border-base-100 bg-base-300 px-2">
      <span className="px-1 text-sm font-bold text-primary select-none">thride</span>

      <button className="btn btn-xs sm:hidden" popoverTarget="menubar">
        Menu
      </button>
      <div className="megamenu megamenu-xs max-sm:megamenu-vertical" id="menubar" popover="auto">
        <span className="megamenu-active"></span>
        {MENUS.map((menu) => {
          const items = registry.byMenu(menu);
          if (items.length === 0) return null;
          const id = `menu-${menu.toLowerCase()}`;
          // group consecutive same-submenu commands into a nested flyout
          type Grouped =
            | { kind: "group"; submenu: string; items: AppCommand[] }
            | { kind: "cmd"; cmd: AppCommand };
          const grouped: Grouped[] = [];
          for (const cmd of items) {
            if (!cmd.submenu) {
              grouped.push({ kind: "cmd", cmd });
              continue;
            }
            const last = grouped.at(-1);
            if (last?.kind === "group" && last.submenu === cmd.submenu) last.items.push(cmd);
            else grouped.push({ kind: "group", submenu: cmd.submenu, items: [cmd] });
          }
          return [
            <button key={menu} popoverTarget={id} className="after:content-none">
              {menu}
            </button>,
            <div key={`${menu}-pop`} id={id} popover="auto" className="overflow-visible">
              <ul className="menu menu-xs w-64 p-1">
                {grouped.map((g) =>
                  g.kind === "group" ? (
                    <li key={g.submenu} className="group/sub relative">
                      <span className="flex items-center gap-2">
                        <span className="flex w-4 justify-center">{g.items[0]?.icon}</span>
                        <span className="flex-1">{g.submenu}</span>
                        <span className="opacity-50">›</span>
                      </span>
                      <ul className="invisible absolute top-0 left-full z-10 ml-0 w-56 rounded-box border border-base-300 bg-base-200 p-1 shadow-lg group-hover/sub:visible">
                        {g.items.map((cmd) => (
                          <MenuItem key={cmd.id} cmd={cmd} />
                        ))}
                      </ul>
                    </li>
                  ) : (
                    <MenuItem key={g.cmd.id} cmd={g.cmd} />
                  ),
                )}
              </ul>
            </div>,
          ];
        })}
      </div>
    </div>
  );
}
