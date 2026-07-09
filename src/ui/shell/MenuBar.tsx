import { useEffect, useState } from "react";
import type { CommandRegistry, MenuId } from "@/ui/commands/CommandRegistry";
import { shortcutLabel } from "@/ui/commands/CommandRegistry";

const MENUS: MenuId[] = ["File", "Edit", "Create", "View", "Help"];

export function MenuBar({ registry }: { registry: CommandRegistry }) {
  const [open, setOpen] = useState<MenuId | null>(null);

  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(null);
    window.addEventListener("pointerdown", close);
    return () => window.removeEventListener("pointerdown", close);
  }, [open]);

  return (
    <div className="t-menubar">
      <div className="t-menubar-item" style={{ fontWeight: 700, color: "var(--t-accent)" }}>
        thride
      </div>
      {MENUS.map((menu) => {
        const items = registry.byMenu(menu);
        if (items.length === 0) return null;
        return (
          <div
            key={menu}
            className="t-menubar-item"
            data-open={open === menu}
            style={{ position: "relative" }}
            onPointerDown={(e) => {
              e.stopPropagation();
              setOpen(open === menu ? null : menu);
            }}
            onPointerEnter={() => open && setOpen(menu)}
          >
            {menu}
            {open === menu ? (
              <div className="t-menu" style={{ top: "100%", left: 0 }}>
                {items.map((cmd) => (
                  <div key={cmd.id}>
                    {cmd.sep ? <div className="t-menu-sep" /> : null}
                    <div
                      className="t-menu-item"
                      data-disabled={!(cmd.enabled?.() ?? true)}
                      onPointerDown={(e) => {
                        e.stopPropagation();
                        setOpen(null);
                        cmd.run();
                      }}
                    >
                      <span>{cmd.title}</span>
                      {cmd.shortcut ? (
                        <span className="t-menu-shortcut">{shortcutLabel(cmd.shortcut)}</span>
                      ) : null}
                    </div>
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
