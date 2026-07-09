import { atom, useAtom, useAtomValue } from "jotai";
import type { CommandRegistry } from "@/ui/commands/CommandRegistry";
import { appStore } from "@/ui/hooks/doc/document";

/** Shell-level UI state: palette, command registry access, context menu. */

export const paletteOpenAtom = atom(false);

/** Imperative open, for commands. */
export function openPalette(): void {
  appStore.set(paletteOpenAtom, true);
}

export function usePalette() {
  const [open, setOpen] = useAtom(paletteOpenAtom);
  return { open, close: () => setOpen(false) };
}

/** The app's command registry, installed by the Shell (for panels/menus). */
export const registryAtom = atom<CommandRegistry | null>(null);

export function setRegistry(reg: CommandRegistry): void {
  appStore.set(registryAtom, reg);
}

export function useRegistry(): CommandRegistry | null {
  return useAtomValue(registryAtom);
}

/**
 * Context-menu entry tree: leaves run actions, branches open submenus.
 * `commandId` entries resolve title/shortcut/enabled/run from the registry
 * so menus and shortcuts stay one definition. All menus support a 16px
 * leading icon.
 */
export interface MenuEntry {
  label?: string;
  commandId?: string;
  icon?: React.ReactNode;
  /** Renders menu-active (radio-style current choice). */
  active?: boolean;
  disabled?: boolean;
  /** Separator above this entry. */
  sep?: boolean;
  run?: () => void;
  children?: MenuEntry[];
}

/** Right-click context menu: an entry tree rendered at a fixed position. */
export interface ContextMenuState {
  x: number;
  y: number;
  entries: MenuEntry[];
}

export const contextMenuAtom = atom<ContextMenuState | null>(null);

export function openContextMenu(state: ContextMenuState): void {
  appStore.set(contextMenuAtom, state);
}

export function useContextMenu() {
  const [menu, setMenu] = useAtom(contextMenuAtom);
  return { menu, close: () => setMenu(null) };
}
