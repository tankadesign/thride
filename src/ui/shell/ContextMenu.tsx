import { useEffect } from "react";
import { shortcutLabel } from "@/ui/commands/CommandRegistry";
import { useContextMenu, useRegistry } from "@/ui/hooks/editor/shell";

/**
 * App-wide right-click context menu. Entries are command ids resolved
 * against the registry, so menus, shortcuts, and context actions stay one
 * definition. Opened via openContextMenu(); closes on run/click-away/Esc.
 */
export function ContextMenu() {
  const { menu, close } = useContextMenu();
  const registry = useRegistry();

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

  if (!menu || !registry) return null;
  const commands = menu.commandIds
    .map((id) => registry.get(id))
    .filter((c): c is NonNullable<typeof c> => !!c);

  // keep the menu on-screen
  const width = 224;
  const x = Math.min(menu.x, window.innerWidth - width - 8);
  const y = Math.min(menu.y, window.innerHeight - commands.length * 26 - 16);

  return (
    <div
      className="fixed inset-0 z-[1500]"
      onPointerDown={close}
      onContextMenu={(e) => e.preventDefault()}
    >
      <ul
        className="menu menu-xs rounded-box border border-base-300 bg-base-200 shadow-lg"
        style={{ position: "fixed", left: x, top: y, width }}
        onPointerDown={(e) => e.stopPropagation()}
      >
        {commands.map((cmd) => {
          const enabled = cmd.enabled?.() ?? true;
          return (
            <li key={cmd.id} className={enabled ? "" : "menu-disabled"}>
              <button
                type="button"
                className="flex justify-between gap-6"
                onClick={() => {
                  close();
                  if (enabled) cmd.run();
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
    </div>
  );
}
