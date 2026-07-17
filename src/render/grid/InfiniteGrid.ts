import { Color, DoubleSide, Mesh, PlaneGeometry, Vector2, Vector3 } from "three";
import { MeshBasicNodeMaterial } from "three/webgpu";
import type { Node } from "three/webgpu";
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
  min,
  mix,
  positionWorld,
  pow,
  smoothstep,
  uniform,
  vec2,
} from "@/materials/tsl";
import { HELPER_LAYER } from "@/render/layers";
import { viewportTheme } from "@/render/theme/viewportTheme";
import type { CameraRig } from "@/render/nav/CameraRig";

/** Finest cascade decade: its cells target ~this many pixels at its floor. */
const BASE_PX = 3;
/** Each decade fades IN as its cells grow across this pixel range. The wide
 *  span (≈1.5 decades of zoom) is what makes the level-to-level transition slow
 *  and smooth as you scroll — ~3× the old single-decade crossfade. */
const FADE_LO = 2;
const FADE_HI = 55;
/** How many decades draw at once — a smooth cascade, not a hard 2-layer pop. */
const LEVELS = 3;
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
 * Infinite adaptive floor grid: a ground plane whose fragment shader draws
 * world-locked grid lines that subdivide as you zoom in and fade out as cells
 * shrink (continuous LOD from screen-space derivatives, so ONE shader serves
 * both perspective distance and ortho zoom). Recentered + sized under the view
 * every frame; a distance fade hides the plane edge so it looks endless.
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
  private readonly uColor = uniform(new Color().copy(viewportTheme.gridLineColor));

  constructor() {
    const mat = new MeshBasicNodeMaterial();
    mat.transparent = true;
    mat.depthWrite = false; // occluded by objects, but never hides gizmos/handles
    mat.side = DoubleSide; // readable from beneath the plane too
    // biome-ignore lint/suspicious/noExplicitAny: color uniform → colorNode
    mat.colorNode = this.uColor as any;
    mat.opacityNode = this.buildAlpha();

    const mesh = new Mesh(new PlaneGeometry(1, 1), mat);
    mesh.rotation.x = -Math.PI / 2; // XY plane → XZ ground
    mesh.position.y = -0.001; // just under y=0 so ground-plane objects win the depth test
    mesh.frustumCulled = false; // we size/place it ourselves each frame
    mesh.renderOrder = -10; // behind other helper-layer overlays
    mesh.layers.set(HELPER_LAYER);
    mesh.matrixAutoUpdate = false;
    this.object = mesh;
  }

  /** Antialiased line coverage (1 on a line, 0 between) for a grid of `spacing`. */
  // biome-ignore lint/suspicious/noExplicitAny: TSL chains hit TS2590 without any
  private gridLine(p: any, spacing: any): any {
    const c: any = p.div(spacing);
    // distance to the nearest line, measured in PIXELS (fwidth = coord/pixel)
    const fw: any = fwidth(c);
    const d: any = abs(fract(c.sub(0.5)).sub(0.5)).div(fw);
    return min(d.x, d.y).min(1).oneMinus();
  }

  private buildAlpha(): Node {
    // biome-ignore lint/suspicious/noExplicitAny: TSL chains hit TS2590 without any
    const p: any = vec2(positionWorld.x, positionWorld.z);
    const fw: any = fwidth(p);
    const w: any = fw.x.max(fw.y); // world units per pixel (worst axis)
    // finest cascade decade: the 10^n whose cells sit near BASE_PX px right now
    const base: any = pow(float(10), floor(log(w.mul(BASE_PX)).div(Math.log(10))));
    // draw LEVELS decades at once, each faded IN by its on-screen cell size — a
    // decade appears as its cells grow across [FADE_LO, FADE_HI] px and recedes
    // as they shrink, so subdivisions cascade smoothly instead of popping and
    // never pile into a too-thick mat (small-celled decades are near-invisible).
    let grid: any = float(0);
    for (let k = 0; k < LEVELS; k++) {
      const spacing: any = base.mul(10 ** k);
      const cellPx: any = spacing.div(w);
      const levelFade: any = smoothstep(FADE_LO, FADE_HI, cellPx);
      grid = grid.max(this.gridLine(p, spacing).mul(levelFade));
    }
    // ORTHO: long radial dissolve from the view center (full until FOG_START·
    // radius, gone by radius) — the plane edge is past the radius, never seen.
    const radial: any = length(p.sub(this.uCenter));
    const orthoFog: any = smoothstep(
      this.uFadeRadius.mul(FOG_START),
      this.uFadeRadius,
      radial,
    ).oneMinus();
    // PERSPECTIVE: exponential haze by 3D camera distance — full inside
    // uHazeStart, then exp decay (asymptotic, so no hard disc edge at any angle).
    const camDist: any = length(positionWorld.sub(this.uCamPos));
    const perspFog: any = clamp(exp(this.uHazeStart.sub(camDist).mul(this.uHazeDensity)), 0, 1);
    const fog: any = mix(perspFog, orthoFog, this.uOrtho);
    return clamp(grid.mul(fog), 0, 1) as Node;
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

  /** Re-read the themed grid color (CSS var change). */
  applyTheme(): void {
    this.uColor.value.copy(viewportTheme.gridLineColor);
  }

  dispose(): void {
    this.object.geometry.dispose();
    (this.object.material as MeshBasicNodeMaterial).dispose();
  }
}
