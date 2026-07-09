import { useAtom } from "jotai";
import { atomWithStorage } from "jotai/utils";

/**
 * Global editor settings (persisted). These get a real Settings page in
 * chunk A6; until then they're adjustable in code / via future UI.
 */

/** Icon size in px across the whole UI. */
export const iconSizeAtom = atomWithStorage("thride.settings.iconSize", 20);

/**
 * Grid snap step in world units (1 unit = 1m → 0.1 = 10cm). Used by
 * shift-snapping during gizmo transforms; snapping is LOCAL — relative to
 * the drag's starting position, not world space.
 */
export const gridSnapSizeAtom = atomWithStorage("thride.settings.gridSnapSize", 0.1);

export function useSettings() {
  const [iconSize, setIconSize] = useAtom(iconSizeAtom);
  const [gridSnapSize, setGridSnapSize] = useAtom(gridSnapSizeAtom);
  return { iconSize, setIconSize, gridSnapSize, setGridSnapSize };
}
