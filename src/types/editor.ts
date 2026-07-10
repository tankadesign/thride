import type { Uuid } from "./core/ids";

/** Built-in editor cameras; a PaneCamera may also be a scene camera node id. */
export type BuiltinCamera =
  | "persp"
  | "ortho" // 45° parallel (axonometric)
  | "top"
  | "bottom"
  | "left"
  | "right"
  | "front"
  | "rear";
export type PaneCamera = BuiltinCamera | Uuid;
export type ViewportLayout = "single" | "quad";
export type GizmoSpace = "local" | "world";

export type ShadingMode = "pbr" | "flat" | "wireframe";

/** Chamfer replaces the beveled edge; straight keeps it and adds flanking loops. */
export type BevelToolMode = "chamfer" | "straight";

/** Live edge-bevel tool parameters (adjustable while the tool is active). */
export interface BevelToolParams {
  width: number;
  /** Ring subdivisions across the bevel (1 = flat chamfer). */
  segments: number;
  /** Skip edges flatter than this dihedral (deviation between face normals). */
  angleDeg: number;
  mode: BevelToolMode;
}

export const defaultBevelParams = (): BevelToolParams => ({
  width: 0.1,
  segments: 1,
  angleDeg: 40,
  mode: "chamfer",
});

/** Per-viewport display settings (viewport background context menu). */
export interface PaneDisplay {
  shading: ShadingMode;
  /** PBR only. */
  shadows: boolean;
  /** Render backfaces (double-sided). */
  backfaces: boolean;
  /** PBR only. State is plumbed now; the AO pass itself lands with post-FX (C6). */
  ssao: boolean;
  grid: boolean;
  /** Wireframe overlay on top of PBR/Flat. No effect in Wireframe mode (already all lines). */
  lines: boolean;
  /** Show edges occluded by surfaces (behind polygons). Requires `lines`. */
  hiddenLines: boolean;
}

export const defaultPaneDisplay = (): PaneDisplay => ({
  shading: "pbr",
  shadows: true,
  backfaces: true,
  ssao: false,
  grid: true,
  lines: false,
  hiddenLines: false,
});

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
  /** Magnet: translate drags snap to the nearest scene vertex/edge. */
  readonly snapEnabled: boolean;
  /** Gizmo axis orientation: object-local (default) or world-aligned. */
  readonly gizmoSpace: GizmoSpace;
  toggleGizmoSpace(): void;
  /** Weld tool armed (point mode): vertex drags slide-weld instead of moving. */
  readonly weldArmed: boolean;
  setWeldArmed(on: boolean): void;
  /** Live edge-bevel tool: active flag + adjustable params (C4D-style). */
  readonly bevelActive: boolean;
  readonly bevelParams: BevelToolParams;
  setBevelActive(on: boolean): void;
  setBevelParams(patch: Partial<BevelToolParams>): void;
  /** Fires only on a bevel PARAM change (so the tool rebuilds, not re-renders). */
  subscribeBevel(cb: () => void): () => void;
  /** Per-pane display settings (shading, shadows, grid…). */
  paneDisplay(pane: number): PaneDisplay;
  setPaneDisplay(pane: number, patch: Partial<PaneDisplay>): void;
  paneCamera(pane: number): PaneCamera;
  setActivePane(pane: number): void;
  setPaneCamera(pane: number, camera: PaneCamera): void;
  /** ⌘4: swap single/quad keeping the maximized pane. */
  toggleLayout(): void;
  /** MMB click on a pane: maximize it, or return to 4-up (C4D behavior). */
  toggleMaximize(pane: number): void;
  subscribe(cb: () => void): () => void;
}
