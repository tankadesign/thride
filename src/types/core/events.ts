import type { Uuid } from "./ids";

/**
 * Document slices with independent version counters. React panels subscribe
 * per-slice via useSyncExternalStore; a bump re-renders only that slice's
 * subscribers.
 */
export type SliceId =
  | "scene"
  | "selection"
  | "meshes"
  | "materials"
  | "animation"
  | "settings"
  | "history";

/**
 * Fine-grained document events. `preview: true` marks transient
 * interactive-session updates (drags) — autosave and expensive derived
 * caches must ignore them.
 */
export type DocEventMap = {
  "scene:node-added": { id: Uuid };
  "scene:node-removed": { id: Uuid; parent: Uuid | null };
  /** Name, flags, or transform changed. */
  "scene:node-changed": { id: Uuid; preview?: boolean };
  /** Reparent or sibling reorder. */
  "scene:hierarchy-changed": { id: Uuid };
  "document:reset": Record<string, never>;
  /** Undo/redo availability changed (push, undo, redo, eviction, clear). */
  "history:changed": { canUndo: boolean; canRedo: boolean };
  /** Object or component selection, or edit mode, changed. */
  "selection:changed": Record<string, never>;
};
