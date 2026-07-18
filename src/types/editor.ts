import type { Uuid } from "./core/ids";
import type { TextureChannel } from "./core/material";

/**
 * What the viewport projection-transform ("Texture") mode is editing: one image
 * channel of one material. Null = not in projection-edit mode. Ephemeral editor
 * state (not in the document); drives the TRS gizmo's projection branch.
 */
export interface ProjectionEditTarget {
  materialId: Uuid;
  textureChannel: TextureChannel;
}

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
/** Color management: output transform per pane (linear pipeline throughout). */
export type ToneMappingMode = "agx" | "aces" | "neutral";

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
  /** Ambient Shadows (GTAO) on/off. PBR + single-pane only. */
  ssao: boolean;
  /** GTAO sample radius (world units) — how far creases darken. */
  aoRadius: number;
  /** GTAO occlusion thickness — max view-depth gap that counts as occlusion.
   * Lower rejects halos from floating/distant geometry; too high and objects
   * that merely float above a surface cast a false AO shadow onto it. */
  aoBias: number;
  /** Hex color occluded areas darken toward (Spline's "Tint"). */
  aoTint: string;
  /** GTAO quality — samples per pixel (more = smoother, slower). */
  aoSamples: number;
  /** GTAO distance falloff (0–1) — how quickly occlusion weakens with distance. */
  aoFalloff: number;
  /** GTAO sample-distribution exponent — biases samples near (>1) vs even (1). */
  aoDistanceExp: number;
  /** GTAO contrast — AO is raised to this power (higher = darker/harder). */
  aoScale: number;
  /** GTAO resolution scale (0–1) — render AO at reduced res for perf. */
  aoResolution: number;
  /** Screen-space reflections (SSR) on/off. PBR + single-pane only. */
  ssr: boolean;
  /** SSR quality: "fast" = gen-1 mirror+blur (on-demand); "high" = stochastic +
   * temporal denoise (accumulates over frames, needs an HDR environment). */
  ssrMode: "fast" | "high";
  /** High-mode recurrent-denoise strength (0–1). */
  ssrDenoise: number;
  /** High-mode convergence frames rendered after a change before idling. */
  ssrMaxFrames: number;
  /** Reflect dielectrics too (not just metals). Off = metals-only (cheaper). */
  ssrReflectNonMetals: boolean;
  /** Max reflection ray distance, world units — how far reflections reach. */
  ssrMaxDistance: number;
  /** Ray-hit thickness — max view-depth gap a ray counts as a surface hit. */
  ssrThickness: number;
  /** Reflection strength multiplier. */
  ssrIntensity: number;
  /** Raymarch quality (0–1) — scales step count (more = crisper, slower). */
  ssrQuality: number;
  /** Roughness-blur quality (1–3) — blur mip passes for glossy reflections. */
  ssrBlurQuality: number;
  /** Screen-edge fade (0–1) — fades reflections out near the frame border. */
  ssrEdgeFade: number;
  /** HDR firefly clamp — caps per-pixel reflected luminance. */
  ssrMaxLuminance: number;
  /** SSR resolution scale (0.25–1) — render reflections at reduced res for perf. */
  ssrResolution: number;
  /** Roughness at which SSR begins fading to IBL (fully gone by roughness 1).
   * Screen-space reflections can't diffuse fully; past this, hand off to the
   * env/PMREM reflection. Higher = SSR persists onto rougher surfaces. */
  ssrRoughnessFade: number;
  // ---- Post-processing (C6). Ambient Shadows + Reflections above are post too;
  // the View Settings modal groups them all under one Post Processing tab. ----
  /** Bloom — HDR glow around highlights. Applied before tone mapping. */
  bloom: boolean;
  /** Luminance above which pixels bloom. */
  bloomThreshold: number;
  /** Bloom intensity. */
  bloomStrength: number;
  /** Bloom spread. */
  bloomRadius: number;
  /** Chromatic aberration — lens colour fringing, strongest at the frame edge. */
  chromatic: boolean;
  /** Fringing strength. */
  chromaticAmount: number;
  /** Vignette — corner darkening. Applied after tone mapping. */
  vignette: boolean;
  /** Vignette strength (0 = none, 1 = heavy). */
  vignetteAmount: number;
  /** Where the vignette falloff starts (0 = center, 1 = corners only). */
  vignetteRadius: number;
  grid: boolean;
  /** The two world axis lines (X/Z) through the origin — separate from the grid. */
  mainAxis: boolean;
  /** Wireframe overlay on top of PBR/Flat. No effect in Wireframe mode (already all lines). */
  lines: boolean;
  /** Show edges occluded by surfaces (behind polygons). Requires `lines`. */
  hiddenLines: boolean;
  /** Output transform (PBR): ACES filmic default, AgX, or neutral. */
  toneMapping: ToneMappingMode;
}

/** pane index (0-3) — used to generate default display settings for each pane. */
export const defaultPaneDisplay = (pane = 0): PaneDisplay => ({
  shading: pane === 0 ? "pbr" : "wireframe",
  shadows: pane === 0,
  backfaces: true,
  ssao: false,
  aoRadius: 0.2,
  aoBias: 0.05,
  aoTint: "#000000",
  aoSamples: 16,
  aoFalloff: 1,
  aoDistanceExp: 1,
  aoScale: 1,
  aoResolution: 1,
  ssr: false,
  ssrMode: "high",
  ssrDenoise: 1,
  ssrMaxFrames: 32,
  ssrReflectNonMetals: true,
  ssrMaxDistance: 10,
  ssrThickness: 0.1,
  ssrIntensity: 1,
  ssrQuality: 0.5,
  ssrBlurQuality: 2,
  ssrEdgeFade: 0.2,
  ssrMaxLuminance: 10,
  ssrResolution: 1,
  ssrRoughnessFade: 0.5,
  bloom: false,
  bloomThreshold: 0.9,
  bloomStrength: 0.35,
  bloomRadius: 0.6,
  chromatic: false,
  chromaticAmount: 1,
  vignette: false,
  vignetteAmount: 0.4,
  vignetteRadius: 0.5,
  grid: true,
  mainAxis: true,
  lines: false,
  hiddenLines: false,
  toneMapping: "aces",
});

/**
 * Per-project viewport settings persisted in the project record (a sibling of
 * the document DTO — UI state stays OUT of the document / GLTF by design). This
 * is the Display-menu state plus the pane layout and camera-type assignments.
 * Camera orbit position is render-rig state (not these atoms) and is not
 * included; per-view cameras graduate into the document at H1.
 */
export interface ViewportSettingsDTO {
  layout: ViewportLayout;
  paneCameras: PaneCamera[];
  paneDisplays: PaneDisplay[];
}

export const defaultViewportSettings = (): ViewportSettingsDTO => ({
  layout: "single",
  paneCameras: ["persp", "top", "front", "right"],
  paneDisplays: [
    defaultPaneDisplay(0),
    defaultPaneDisplay(1),
    defaultPaneDisplay(2),
    defaultPaneDisplay(3),
  ],
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
  /** Spline pen tool active (work-plane pick or drawing). */
  readonly penActive: boolean;
  setPenActive(on: boolean): void;
  /** Projection-transform ("Texture") mode target: the material+channel whose
   * projection the gizmo edits, or null when not in that mode. */
  readonly projectionEditTarget: ProjectionEditTarget | null;
  setProjectionEditTarget(t: ProjectionEditTarget | null): void;
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
