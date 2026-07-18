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
  /**
   * Binding fires only while the pointer is over the viewport (handled in
   * ViewportInput, not the global handler). The key still shows in menus.
   */
  viewportScoped?: boolean;
  enabled?: () => boolean;
  run: () => void;
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

  subscribe(cb: () => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  private notify(): void {
    for (const cb of [...this.listeners]) cb();
  }
}
