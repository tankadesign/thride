export type MenuId = "File" | "Edit" | "Create" | "Mesh" | "View" | "Help";

export interface AppCommand {
  id: string;
  title: string;
  menu?: MenuId;
  /** Group under a named submenu within its menu (e.g. Create → Lights). */
  submenu?: string;
  /** 16px leading icon shown in menus/palette/context menus. */
  icon?: React.ReactNode;
  /** After a separator within its menu group. */
  sep?: boolean;
  /** e.g. "mod+z", "shift+mod+z", "f", "delete". mod = ⌘ on mac, ctrl elsewhere. */
  shortcut?: string;
  /**
   * Shortcut fires only while the pointer is over the viewport (handled in
   * ViewportInput, not the global handler). The key still shows in menus.
   */
  viewportScoped?: boolean;
  enabled?: () => boolean;
  run: () => void;
}

const IS_MAC = typeof navigator !== "undefined" && /Mac/.test(navigator.platform);

export function shortcutLabel(sc: string): string {
  return sc
    .split("+")
    .map((p) =>
      p === "mod"
        ? IS_MAC
          ? "⌘"
          : "Ctrl"
        : p === "shift"
          ? "⇧"
          : p === "alt"
            ? "⌥"
            : p.toUpperCase(),
    )
    .join(IS_MAC ? "" : "+");
}

/** Central command registry: single registration → menus, palette, shortcuts. */
export class CommandRegistry {
  private commands = new Map<string, AppCommand>();
  private listeners = new Set<() => void>();

  register(...cmds: AppCommand[]): void {
    for (const c of cmds) this.commands.set(c.id, c);
    this.notify();
  }

  get(id: string): AppCommand | undefined {
    return this.commands.get(id);
  }

  run(id: string): void {
    const c = this.commands.get(id);
    if (c && (c.enabled?.() ?? true)) c.run();
  }

  all(): AppCommand[] {
    return [...this.commands.values()];
  }

  byMenu(menu: MenuId): AppCommand[] {
    return this.all().filter((c) => c.menu === menu);
  }

  /** Returns true (and prevents default) when a command consumed the event. */
  handleKey(e: KeyboardEvent): boolean {
    const key = e.key.toLowerCase();
    for (const c of this.commands.values()) {
      if (!c.shortcut || c.viewportScoped) continue;
      const parts = c.shortcut.split("+");
      const want = parts.at(-1)!;
      const mod = parts.includes("mod");
      const shift = parts.includes("shift");
      const alt = parts.includes("alt");
      const modDown = IS_MAC ? e.metaKey : e.ctrlKey;
      const wantKey = want === "delete" ? key === "delete" || key === "backspace" : key === want;
      if (wantKey && mod === modDown && shift === e.shiftKey && alt === e.altKey) {
        if (c.enabled?.() ?? true) {
          e.preventDefault();
          c.run();
        }
        return true;
      }
    }
    return false;
  }

  subscribe(cb: () => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  private notify(): void {
    for (const cb of [...this.listeners]) cb();
  }
}
