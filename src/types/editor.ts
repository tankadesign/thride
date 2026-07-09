import type { Uuid } from "./core/ids";

/** Built-in editor cameras; a PaneCamera may also be a scene camera node id. */
export type BuiltinCamera = "persp" | "top" | "front" | "right";
export type PaneCamera = BuiltinCamera | Uuid;
export type ViewportLayout = "single" | "quad";
export type GizmoSpace = "local" | "world";

/**
 * Contract the render layer uses to read viewport editor state. Implemented
 * by the jotai-backed store in ui/hooks/editor/viewport.ts — render/ must
 * not import ui/, so it depends on this interface only.
 */
export interface EditorViewportState {
  readonly layout: ViewportLayout;
  /** Pane with input focus (nav, framing, gizmo rays). */
  readonly activePane: number;
  /** Which logical pane the single (maximized) layout shows. */
  readonly maximizedPane: number;
  readonly paletteOpen: boolean;
  /** Grid snap step in world units for shift-snapping (settings). */
  readonly gridSnapSize: number;
  /** Gizmo axis orientation: object-local (default) or world-aligned. */
  readonly gizmoSpace: GizmoSpace;
  toggleGizmoSpace(): void;
  paneCamera(pane: number): PaneCamera;
  setActivePane(pane: number): void;
  setPaneCamera(pane: number, camera: PaneCamera): void;
  /** ⌘4: swap single/quad keeping the maximized pane. */
  toggleLayout(): void;
  /** MMB click on a pane: maximize it, or return to 4-up (C4D behavior). */
  toggleMaximize(pane: number): void;
  subscribe(cb: () => void): () => void;
}
