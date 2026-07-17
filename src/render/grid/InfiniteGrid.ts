import { Color, DoubleSide, Mesh, PlaneGeometry, Vector2 } from "three";
import { MeshBasicNodeMaterial } from "three/webgpu";
import type { Node } from "three/webgpu";
import {
  abs,
  clamp,
  float,
  floor,
  fract,
  fwidth,
  length,
  log,
  min,
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
/** Radial fog: grid holds full until this fraction of the fade radius, then
 *  dissolves over the long remaining band so the plane edge never reads. */
const FOG_START = 0.12;
/** Fog completes by this multiple of the view extent. */
const FADE_EXTENTS = 4;
/** Cap so a zoomed-out perspective view's plane stays inside the 5000 far clip
 *  (plane half-extent ≈ 1.3× this, plus the focus offset). */
const FADE_MAX = 2200;

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
  private readonly uCenter = uniform(new Vector2());
  private readonly uFadeRadius = uniform(1);
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
    // radial FOG around the view center: a long, soft dissolve (full until
    // FOG_START·radius, gone by radius) so the finite plane edge never shows
    const dist: any = length(p.sub(this.uCenter));
    const fog: any = smoothstep(this.uFadeRadius.mul(FOG_START), this.uFadeRadius, dist).oneMinus();
    return clamp(grid.mul(fog), 0, 1) as Node;
  }

  /**
   * Recenter + size under this pane's view. MUST run right before the pane
   * renders (per-camera uniforms — a once-per-frame call would leave 3 of 4
   * panes wrong).
   */
  configure(rig: CameraRig): void {
    const { center, extent } = rig.groundView();
    const fadeRadius = Math.min(extent * FADE_EXTENTS, FADE_MAX);
    // PlaneGeometry(1,1) has HALF-extent 0.5, so scale = 2.6·radius gives a
    // half-extent of 1.3·radius — the fog reaches 0 well inside the plane edge
    // (the earlier 1.35× left the square edge cutting the grid at ~0.68·radius,
    // still ~80% opaque: the hard "segmented disc" boundary).
    const size = fadeRadius * 2.6;
    this.object.position.set(center.x, -0.001, center.z);
    this.object.scale.set(size, size, 1);
    this.object.updateMatrix();
    this.object.updateMatrixWorld();
    this.uCenter.value.set(center.x, center.z);
    this.uFadeRadius.value = fadeRadius;
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
