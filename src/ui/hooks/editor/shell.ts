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

/** Right-click context menu: command ids rendered at a fixed position. */
export interface ContextMenuState {
  x: number;
  y: number;
  commandIds: string[];
}

export const contextMenuAtom = atom<ContextMenuState | null>(null);

export function openContextMenu(state: ContextMenuState): void {
  appStore.set(contextMenuAtom, state);
}

export function useContextMenu() {
  const [menu, setMenu] = useAtom(contextMenuAtom);
  return { menu, close: () => setMenu(null) };
}
