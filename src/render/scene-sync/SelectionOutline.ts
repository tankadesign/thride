import {
  BackSide,
  type BufferGeometry,
  type Camera,
  MathUtils,
  Mesh,
  Object3D,
  OrthographicCamera,
  PerspectiveCamera,
  Vector3,
} from "three";
import { MeshBasicNodeMaterial } from "three/webgpu";
import { HELPER_LAYER } from "@/render/layers";
import type { Node } from "three/webgpu";
import type { Uuid } from "@/types/core";
import type { Document } from "@/core";
import { normalLocal, positionLocal, uniform } from "@/materials/tsl";
import { viewportTheme } from "@/render/theme/viewportTheme";

const OUTLINE_PX = 2;

interface OutlineEntry {
  mesh: Mesh;
  offset: { value: number }; // uniform node driving the normal expansion
}

/** 2px primary-color silhouette (backface hull expanded along normals) on selected mesh nodes. */
export class SelectionOutline {
  private outlines = new Map<Uuid, OutlineEntry>();
  private readonly color = viewportTheme.primary;

  /** Drop everything without disposing children — call after a full scene-graph rebuild. */
  clear(): void {
    this.outlines.clear();
  }

  has(id: Uuid): boolean {
    return this.outlines.has(id);
  }

  /** Keep geometry in sync when the source mesh's geometry is rebuilt. */
  updateGeometry(id: Uuid, geometry: BufferGeometry): void {
    const entry = this.outlines.get(id);
    if (entry) entry.mesh.geometry = geometry;
  }

  /** Rebuild membership from current selection — call on selection change. */
  sync(doc: Document, objects: ReadonlyMap<Uuid, Object3D>): void {
    // component/texture modes get component overlays instead — the object
    // silhouette would just shout over them (mode changes fire selection:changed,
    // so entering/leaving a mode passes through here)
    const suppress = doc.selection.editMode !== "object";
    for (const [id, entry] of [...this.outlines]) {
      if (suppress || !doc.selection.has(id) || !objects.has(id)) {
        entry.mesh.removeFromParent();
        (entry.mesh.material as MeshBasicNodeMaterial).dispose();
        this.outlines.delete(id);
      }
    }
    if (suppress) return;
    for (const id of doc.selection.objectIds) {
      if (this.outlines.has(id)) continue;
      const obj = objects.get(id);
      if (!(obj instanceof Mesh) || obj.userData.spline) continue;
      const offset = uniform(0.01);
      const mat = new MeshBasicNodeMaterial();
      mat.color.copy(this.color);
      mat.side = BackSide;
      // don't write depth: the expanded hull would otherwise pollute the depth
      // buffer GTAO samples, painting false Ambient Shadows onto the selected
      // object (and its inner edges). The ring still shows — the real surface
      // paints over the interior and closer objects paint over the ring.
      mat.depthWrite = false;
      // Cast to any before chaining to prevent TSL's combinatorial union explosion (TS2590 / tsgolint hang)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      mat.positionNode = (positionLocal as any).add((normalLocal as any).mul(offset)) as Node;
      const outline = new Mesh(obj.geometry, mat);
      outline.raycast = () => {}; // never pickable
      outline.userData.outline = true;
      outline.renderOrder = -1; // hull first, real surface wins the depth test
      // helper layer: outlines must not appear in SSR / planar-mirror
      // reflections; the viewport's overlay render draws them instead
      outline.layers.set(HELPER_LAYER);
      obj.add(outline);
      this.outlines.set(id, { mesh: outline, offset });
    }
  }

  /**
   * Keep outlines exactly OUTLINE_PX thick for this pane's camera. Called
   * per pane before rendering (world units per pixel depend on the camera).
   */
  updateSizes(
    camera: Camera,
    viewportHeightPx: number,
    objects: ReadonlyMap<Uuid, Object3D>,
  ): void {
    if (this.outlines.size === 0 || viewportHeightPx <= 0) return;
    const objPos = new Vector3();
    const objScale = new Vector3();
    for (const [id, entry] of this.outlines) {
      const obj = objects.get(id);
      if (!obj) continue;
      obj.getWorldPosition(objPos);
      obj.getWorldScale(objScale);
      let worldPerPixel: number;
      if (camera instanceof PerspectiveCamera) {
        const dist = camera.position.distanceTo(objPos);
        worldPerPixel =
          (2 * dist * Math.tan(MathUtils.degToRad(camera.fov / 2))) / viewportHeightPx;
      } else {
        const ortho = camera as OrthographicCamera;
        worldPerPixel = (ortho.top - ortho.bottom) / viewportHeightPx;
      }
      // compensate the object's world scale (positionNode offsets in local space)
      const avgScale =
        (Math.abs(objScale.x) + Math.abs(objScale.y) + Math.abs(objScale.z)) / 3 || 1;
      entry.offset.value = (OUTLINE_PX * worldPerPixel) / avgScale;
    }
  }
}
