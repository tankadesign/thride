import { atom, useAtom } from "jotai";
import { appStore } from "@/ui/hooks/doc/document";

/** Shell-level UI state: command palette visibility (grows with the shell). */

export const paletteOpenAtom = atom(false);

/** Imperative open, for commands. */
export function openPalette(): void {
  appStore.set(paletteOpenAtom, true);
}

export function usePalette() {
  const [open, setOpen] = useAtom(paletteOpenAtom);
  return { open, close: () => setOpen(false) };
}
