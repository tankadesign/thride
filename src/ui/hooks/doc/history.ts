import { useDocument, useSliceVersion } from "./document";

export interface HistoryInfo {
  canUndo: boolean;
  canRedo: boolean;
  undoLabel: string | null;
  redoLabel: string | null;
  steps: number;
  bytes: number;
}

/** Undo/redo availability + labels for the Edit menu and toolbar. */
export function useHistoryInfo(): HistoryInfo {
  const doc = useDocument();
  useSliceVersion("history");
  const { steps, bytes } = doc.history.stats;
  return {
    canUndo: doc.history.canUndo,
    canRedo: doc.history.canRedo,
    undoLabel: doc.history.undoLabel,
    redoLabel: doc.history.redoLabel,
    steps,
    bytes,
  };
}
