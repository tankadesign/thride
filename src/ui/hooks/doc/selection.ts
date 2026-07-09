import type { EditMode, Uuid } from "@/types/core";
import { useDocument, useSliceVersion } from "./document";

export interface SelectionInfo {
  objectIds: readonly Uuid[];
  active: Uuid | null;
  editMode: EditMode;
}

/** Current object selection + edit mode (re-renders on selection bumps). */
export function useSelectionInfo(): SelectionInfo {
  const doc = useDocument();
  useSliceVersion("selection");
  return {
    objectIds: doc.selection.objectIds,
    active: doc.selection.active,
    editMode: doc.selection.editMode,
  };
}
