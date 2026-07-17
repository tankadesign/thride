import { Color, DoubleSide, Mesh, PlaneGeometry, Vector2, Vector3 } from "three";
import { MeshBasicNodeMaterial } from "three/webgpu";
import {
  abs,
  clamp,
  exp,
  float,
  floor,
  fract,
  fwidth,
  length,
  log,
  max,
  min,
  mix,
  positionWorld,
  pow,
  smoothstep,
  uniform,
  vec2,
  type Float,
  type Vec2,
  type Vec3,
} from "@/materials/tsl";
import { HELPER_LAYER } from "@/render/layers";
import { viewportTheme } from "@/render/theme/viewportTheme";
import type { CameraRig } from "@/render/nav/CameraRig";

/** On-screen cell size (px) of the finest decade at its LARGEST, i.e. right
 *  before it hands off to the next level. Bigger = sparser grid. */
const GRID_PX = 14;
/** Brightness a decade has when it "graduates" from middle to finest — the
 *  crossfade runs 1 → MINOR_ALPHA over one decade of zoom, then
 *  MINOR_ALPHA → 0 over the next, so a full fade spans TWO decades. */
const MINOR_ALPHA = 0.45;
/** Main-axis half-width in pixels (grid lines are ~1px — the axis reads as a
 *  clearly heavier stroke, and fades with the same fog). */
const AXIS_PX = 1.6;

// --- ortho fade: a long radial dissolve from the view center ---
/** Grid holds full until this fraction of the fade radius, then dissolves over
 *  the long remaining band so the plane edge never reads. */
const FOG_START = 0.12;
/** Fog completes by this multiple of the view extent. */
const FADE_EXTENTS = 4;
/** Cap so the plane stays inside the 5000 far clip (half-extent ≈ 1.3× this). */
const FADE_MAX = 2200;

// --- perspective fade: EXPONENTIAL haze by camera distance ---
// A radial disc has a hard zero-alpha radius that projects to a visible line
// across the ground at grazing angles; exponential haze is asymptotic (never
// reaches a hard edge), so the grid just dissolves toward the horizon. Distances
// scale with the view extent BUT are floored — else zooming right in shrinks
// the extent to ~0 and the haze fades the grid across the whole working area
// (the "grid vanishes when zoomed all the way in" bug) — and capped so the
// fade still completes inside the 5000 far clip when zoomed way out.
/** Grid stays fully solid within this camera distance. */
const HAZE_START = 2;
const HAZE_START_MIN = 4;
const HAZE_START_MAX = 2500;
/** e-fold distance of the haze (bigger = gentler). */
const HAZE_FALLOFF = 4;
const HAZE_FALLOFF_MIN = 12;
const HAZE_FALLOFF_MAX = 700;
/** Cap on the perspective plane half-extent (stays inside the far clip). */
const PERSP_REACH_MAX = 4700;

/**
 * Infinite adaptive floor grid + main axis: a ground plane whose fragment
 * shader draws world-locked grid lines that subdivide as you zoom in
 * (continuous LOD from screen-space derivatives, so ONE shader serves both
 * perspective distance and ortho zoom) plus the two world axis lines as
 * heavier strokes. Both are per-pane toggles (uniforms); the axis inherits
 * the grid's fog/AA/occlusion by construction — a separate fat-line object
 * can't (Line2's expanded vertices break positionWorld-based fog).
 *
 * LOD continuity: three decades draw at once with weights (f = fract of the
 * continuous decade coordinate): finest MINOR_ALPHA→0, middle 1→MINOR_ALPHA,
 * coarsest 1. At a decade boundary every family's weight matches its
 * predecessor's, and the entering coarsest coincides with already-solid
 * middle lines — mathematically continuous, so the boundary is invisible.
 * The old scheme faded each level by its own cell size, which popped the
 * entering coarse level 0.5→1.0 along an iso-distance line ("line stops at
 * a boundary") — and its per-level fwidth(p/spacing) took derivatives of the
 * jumping spacing, spraying dot artifacts along that seam. AA here divides
 * world distance by fwidth(p) ONLY (smooth), never by a derivative of
 * anything containing the floor() jump.
 *
 * On {@link HELPER_LAYER}: excluded from SSR / planar reflections (a large
 * transparent plane would pollute the SSR G-buffer), drawn in the viewport's
 * helper overlay pass over the scene depth so real objects occlude it.
 */
export class InfiniteGrid {
  readonly object: Mesh;
  /** Ortho radial fade. */
  private readonly uCenter = uniform(new Vector2());
  private readonly uFadeRadius = uniform(1);
  /** Perspective exponential haze. */
  private readonly uCamPos = uniform(new Vector3());
  private readonly uHazeStart = uniform(1);
  private readonly uHazeDensity = uniform(1);
  /** 1 = ortho radial, 0 = perspective haze. */
  private readonly uOrtho = uniform(0);
  /** Per-pane overlay toggles (the plane renders when either is on). */
  private readonly uGrid = uniform(1);
  private readonly uAxis = uniform(1);
  /** The three viewportTheme grid colors: minor cells / major lines / main axis. */
  private readonly uCellColor = uniform(new Color().copy(viewportTheme.gridLineColor));
  private readonly uLineColor = uniform(new Color().copy(viewportTheme.gridLineColor));
  private readonly uAxisColor = uniform(new Color().copy(viewportTheme.gridMainAxisLineColor));

  constructor() {
    const mat = new MeshBasicNodeMaterial();
    mat.transparent = true;
    mat.depthWrite = false; // occluded by objects, but never hides gizmos/handles
    mat.side = DoubleSide; // readable from beneath the plane too
    const { color, opacity } = this.buildNodes();
    mat.colorNode = color;
    mat.opacityNode = opacity;

    const mesh = new Mesh(new PlaneGeometry(1, 1), mat);
    mesh.rotation.x = -Math.PI / 2; // XY plane → XZ ground
    mesh.position.y = -0.001; // just under y=0 so ground-plane objects win the depth test
    mesh.frustumCulled = false; // we size/place it ourselves each frame
    mesh.renderOrder = -10; // behind other helper-layer overlays
    mesh.layers.set(HELPER_LAYER);
    mesh.matrixAutoUpdate = false;
    this.object = mesh;
  }

  /**
   * Antialiased line coverage (1 on a line, 0 between) for a grid of `spacing`.
   * Distance to the nearest line is measured in WORLD units, converted to
   * pixels with fwidth(p) — spacing jumps at LOD boundaries, so taking
   * derivatives of p/spacing (the old way) produced garbage there (the dots).
   */
  private gridLine(p: Vec2, fwp: Vec2, spacing: Float): Float {
    const distW = abs(fract(p.div(spacing).sub(0.5)).sub(0.5)).mul(spacing);
    const dPx = distW.div(fwp);
    return min(dPx.x, dPx.y).min(1).oneMinus();
  }

  /**
   * Build the material's color + opacity nodes together so they share the
   * per-fragment line-coverage graph (the TSL builder computes it once).
   * COLOR uses the three theme tiers: minor cell lines → cellColor, major
   * (coarser-decade) lines tint toward lineColor, the x=0/z=0 axes → axisColor.
   */
  private buildNodes(): { color: Vec3; opacity: Float } {
    const p: Vec2 = vec2(positionWorld.x, positionWorld.z);
    const fwp: Vec2 = fwidth(p);
    const w: Float = fwp.x.max(fwp.y); // world units per pixel (worst axis)
    // continuous decade coordinate; f is the crossfade phase within a decade
    const t: Float = log(w.mul(GRID_PX)).div(Math.log(10));
    const f: Float = fract(t);
    const lod0: Float = pow(float(10), floor(t)); // finest drawn decade
    const c0: Float = this.gridLine(p, fwp, lod0);
    const c1: Float = this.gridLine(p, fwp, lod0.mul(10));
    const c2: Float = this.gridLine(p, fwp, lod0.mul(100));
    // continuity-locked weights (see class docs): finest K→0, middle 1→K, coarsest 1
    const w0: Float = mix(float(MINOR_ALPHA), float(0), f);
    const w1: Float = mix(float(1), float(MINOR_ALPHA), f);
    const gridCov: Float = c0.mul(w0).max(c1.mul(w1)).max(c2).mul(this.uGrid);
    // coarser-decade lines read as "major" (tint toward lineColor); the finest
    // subdivisions stay cellColor. cellColor↔lineColor are close grays, so the
    // slight tier discontinuity at a decade boundary is imperceptible.
    const majorTint: Float = c1.mul(w1).add(c2).min(1);
    const gridColor: Vec3 = mix(this.uCellColor, this.uLineColor, majorTint);
    // main axis: the x=0 / z=0 world lines as heavier AA strokes, own color
    const axisPx: Vec2 = abs(p).div(fwp); // px distance to the Z axis (x=0), X axis (z=0)
    const axisCov: Float = max(
      axisPx.x.div(AXIS_PX).min(1).oneMinus(),
      axisPx.y.div(AXIS_PX).min(1).oneMinus(),
    ).mul(this.uAxis);
    const color: Vec3 = mix(gridColor, this.uAxisColor, axisCov);
    const cov: Float = gridCov.max(axisCov);
    // ORTHO: long radial dissolve from the view center (full until FOG_START·
    // radius, gone by radius) — the plane edge is past the radius, never seen.
    const radial: Float = length(p.sub(this.uCenter));
    const orthoFog: Float = smoothstep(
      this.uFadeRadius.mul(FOG_START),
      this.uFadeRadius,
      radial,
    ).oneMinus();
    // PERSPECTIVE: exponential haze by 3D camera distance — full inside
    // uHazeStart, then exp decay (asymptotic, so no hard disc edge at any angle).
    const camDist: Float = length(positionWorld.sub(this.uCamPos));
    const perspFog: Float = clamp(exp(this.uHazeStart.sub(camDist).mul(this.uHazeDensity)), 0, 1);
    const fog: Float = mix(perspFog, orthoFog, this.uOrtho);
    return { color, opacity: clamp(cov.mul(fog), 0, 1) };
  }

  /** Per-pane overlay toggles — the caller keeps the plane visible if either is on. */
  setToggles(grid: boolean, mainAxis: boolean): void {
    this.uGrid.value = grid ? 1 : 0;
    this.uAxis.value = mainAxis ? 1 : 0;
  }

  /**
   * Recenter + size under this pane's view. MUST run right before the pane
   * renders (per-camera uniforms — a once-per-frame call would leave 3 of 4
   * panes wrong).
   */
  configure(rig: CameraRig): void {
    const { center, extent } = rig.groundView();
    // PlaneGeometry(1,1) has HALF-extent 0.5, so the plane's world half-extent
    // is 0.5·scale — must exceed where the fade reaches 0, or the square edge
    // cuts a still-opaque grid (the old "segmented disc").
    let half: number;
    if (rig.isPerspective) {
      // exponential haze keyed to the camera — no radial disc. Floors keep the
      // grid solid over the working area when zoomed right in (tiny extent);
      // caps keep the fade inside the far clip when zoomed way out.
      const clampJs = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);
      const hazeStart = clampJs(extent * HAZE_START, HAZE_START_MIN, HAZE_START_MAX);
      const falloff = clampJs(extent * HAZE_FALLOFF, HAZE_FALLOFF_MIN, HAZE_FALLOFF_MAX);
      rig.camera.getWorldPosition(this.uCamPos.value);
      this.uHazeStart.value = hazeStart;
      this.uHazeDensity.value = 1 / falloff;
      this.uOrtho.value = 0;
      // reach far enough that the haze (≈e^-4.5 here) is negligible at the edge
      half = Math.min(hazeStart + falloff * 4.5, PERSP_REACH_MAX);
    } else {
      const fadeRadius = Math.min(extent * FADE_EXTENTS, FADE_MAX);
      this.uCenter.value.set(center.x, center.z);
      this.uFadeRadius.value = fadeRadius;
      this.uOrtho.value = 1;
      half = fadeRadius * 1.3;
    }
    this.object.position.set(center.x, -0.001, center.z);
    this.object.scale.set(half * 2, half * 2, 1);
    this.object.updateMatrix();
    this.object.updateMatrixWorld();
  }

  /** Re-read the themed grid colors (CSS var change). */
  applyTheme(): void {
    this.uCellColor.value.copy(viewportTheme.gridLineColor);
    this.uLineColor.value.copy(viewportTheme.gridLineColor);
    this.uAxisColor.value.copy(viewportTheme.gridMainAxisLineColor);
  }

  dispose(): void {
    this.object.geometry.dispose();
    (this.object.material as MeshBasicNodeMaterial).dispose();
  }
}
