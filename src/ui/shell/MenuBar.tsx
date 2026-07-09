import type { CommandRegistry, MenuId } from "@/ui/commands/CommandRegistry";
import { shortcutLabel } from "@/ui/commands/CommandRegistry";
import { useHistoryInfo } from "@/ui/hooks/doc/history";
import { useSelectionInfo } from "@/ui/hooks/doc/selection";

const MENUS: MenuId[] = ["File", "Edit", "Create", "View", "Help"];

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
          return [
            <button key={menu} popoverTarget={id} className="after:content-none">
              {menu}
            </button>,
            <div key={`${menu}-pop`} id={id} popover="auto">
              <ul className="menu menu-xs w-60 p-1">
                {items.map((cmd) => {
                  const enabled = cmd.enabled?.() ?? true;
                  return (
                    <li key={cmd.id} className={enabled ? "" : "menu-disabled"}>
                      {cmd.sep ? <span className="mx-0 my-0.5 block h-px bg-base-300 p-0" /> : null}
                      <button
                        type="button"
                        className="flex justify-between gap-6"
                        onClick={(e) => {
                          (
                            e.currentTarget.closest("[popover]") as HTMLElement | null
                          )?.hidePopover();
                          cmd.run();
                        }}
                      >
                        <span>{cmd.title}</span>
                        {cmd.shortcut ? (
                          <kbd className="kbd kbd-xs opacity-60">{shortcutLabel(cmd.shortcut)}</kbd>
                        ) : null}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>,
          ];
        })}
      </div>
    </div>
  );
}
