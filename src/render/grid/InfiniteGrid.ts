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

/** Pixels the coarse (solid) decade's cells span before it hands off to the
 *  next — sets how dense the grid reads (bigger = sparser lines). */
const CELL_PX = 22;
/** Subdivision lines are dimmer than the decade lines so a busy grid stays
 *  readable (they also fade out entirely as they shrink; see the shader). */
const SUB_ALPHA = 0.5;
/** Grid fades to nothing by this multiple of the view extent — past the plane
 *  edge and (for perspective) before the far clip, so it reads as infinite. */
const FADE_EXTENTS = 3;
const FADE_MAX = 3800; // hard cap so a zoomed-out persp view stays inside far clip

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
    // continuous decade index: 10^level is the cell size that spans CELL_PX px.
    const level: any = log(w.mul(CELL_PX)).div(Math.log(10));
    const lf: any = fract(level);
    const fine: any = pow(float(10), floor(level)); // shrinking decade (fades with lf)
    const coarse: any = fine.mul(10); // always-solid decade
    // fine subdivisions fade to nothing as their cells shrink past ~CELL_PX/10 px
    const grid: any = this.gridLine(p, coarse).max(
      this.gridLine(p, fine).mul(lf.oneMinus()).mul(SUB_ALPHA),
    );
    // radial fade around the view center so the finite plane edge never shows
    const dist: any = length(p.sub(this.uCenter));
    const fade: any = smoothstep(this.uFadeRadius, this.uFadeRadius.mul(0.55), dist);
    return clamp(grid.mul(fade), 0, 1) as Node;
  }

  /**
   * Recenter + size under this pane's view. MUST run right before the pane
   * renders (per-camera uniforms — a once-per-frame call would leave 3 of 4
   * panes wrong).
   */
  configure(rig: CameraRig): void {
    const { center, extent } = rig.groundView();
    const fadeRadius = Math.min(extent * FADE_EXTENTS, FADE_MAX);
    const size = fadeRadius * 1.35; // plane reaches past where the fade completes
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
