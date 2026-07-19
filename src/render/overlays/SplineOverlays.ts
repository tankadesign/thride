import {
  BufferAttribute,
  BufferGeometry,
  type Camera,
  DoubleSide,
  DynamicDrawUsage,
  Group,
  InstancedMesh,
  LineBasicMaterial,
  LineSegments,
  MathUtils,
  Matrix4,
  MeshBasicMaterial,
  type Object3D,
  type OrthographicCamera,
  type PerspectiveCamera,
  PlaneGeometry,
  Quaternion,
  Vector3,
} from "three";
import type { Uuid } from "@/types/core";
import type { Document } from "@/core";
import type { SplineData } from "@/types/geometry/spline";
import { splineStamp } from "@/geometry/splines/eval";
import type { SceneSynchronizer } from "@/render/scene-sync/SceneSynchronizer";
import { viewportTheme } from "@/render/theme/viewportTheme";

const ANCHOR_PX = 8;
const KNOB_PX = 6;

/**
 * Point-mode overlays for the ACTIVE spline node: anchor billboards
 * (selected = primary), and for selected anchors the tangent handles —
 * a line from the anchor to each handle tip plus a knob billboard to grab.
 * Small data (dozens of points), so buffers rebuild every update.
 */
export class SplineOverlays {
  readonly group = new Group();
  private readonly doc: Document;
  private readonly sync: SceneSynchronizer;
  private readonly localRoot = new Group();
  private readonly handleLines: LineSegments;
  private anchorsSel: InstancedMesh;
  private anchorsUnsel: InstancedMesh;
  private knobs: InstancedMesh;

  constructor(doc: Document, sync: SceneSynchronizer) {
    this.doc = doc;
    this.sync = sync;
    this.group.name = "spline-overlays";
    this.group.visible = false;
    this.localRoot.matrixAutoUpdate = false;
    this.group.add(this.localRoot);

    this.handleLines = new LineSegments(
      new BufferGeometry(),
      new LineBasicMaterial({ color: viewportTheme.accent, depthTest: false }),
    );
    this.handleLines.renderOrder = 940;
    this.handleLines.raycast = () => {};
    this.handleLines.frustumCulled = false;
    this.localRoot.add(this.handleLines);

    this.anchorsSel = this.makePoints(viewportTheme.selectedPointColor, 64);
    this.anchorsUnsel = this.makePoints(viewportTheme.pointColor, 64);
    this.knobs = this.makePoints(viewportTheme.accent, 128);
  }

  private makePoints(color: typeof viewportTheme.primary, capacity: number): InstancedMesh {
    const m = new InstancedMesh(
      new PlaneGeometry(1, 1),
      new MeshBasicMaterial({ color, depthTest: false, depthWrite: false, side: DoubleSide }),
      capacity,
    );
    m.instanceMatrix.setUsage(DynamicDrawUsage);
    m.renderOrder = 950;
    m.count = 0;
    m.raycast = () => {};
    m.frustumCulled = false;
    this.group.add(m);
    return m;
  }

  private grow(m: InstancedMesh, needed: number, color: typeof viewportTheme.primary) {
    if (m.instanceMatrix.count >= needed) return m;
    m.removeFromParent();
    m.geometry.dispose();
    (m.material as MeshBasicMaterial).dispose();
    m.dispose();
    return this.makePoints(color, Math.max(needed, m.instanceMatrix.count * 2));
  }

  /** Per pane, before render. */
  update(camera: Camera, paneHeightPx: number): void {
    const ctx = this.activeContext();
    if (!ctx) {
      this.group.visible = false;
      return;
    }
    this.group.visible = true;
    const { data, object } = ctx;
    object.updateMatrixWorld();
    this.localRoot.matrix.copy(object.matrixWorld);

    const selected = this.selectedSet(ctx.nodeId, data);
    this.anchorsSel = this.grow(this.anchorsSel, data.points.length, viewportTheme.primary);
    this.anchorsUnsel = this.grow(this.anchorsUnsel, data.points.length, viewportTheme.pointColor);
    this.knobs = this.grow(this.knobs, data.points.length * 2, viewportTheme.accent);

    const quat = new Quaternion();
    camera.getWorldQuaternion(quat);
    const ortho = camera as OrthographicCamera;
    const persp = camera as PerspectiveCamera;
    const camPos = new Vector3().setFromMatrixPosition(camera.matrixWorld);
    const orthoPerPixel = ortho.isOrthographicCamera
      ? (ortho.top - ortho.bottom) / Math.max(1, paneHeightPx)
      : 0;
    const compose = (m: InstancedMesh, slot: number, world: Vector3, px: number) => {
      const perPixel = ortho.isOrthographicCamera
        ? orthoPerPixel
        : (2 * camPos.distanceTo(world) * Math.tan(MathUtils.degToRad(persp.fov / 2))) /
          Math.max(1, paneHeightPx);
      const mat = new Matrix4().compose(
        world,
        quat,
        new Vector3().setScalar(Math.max(1e-6, px * perPixel)),
      );
      m.setMatrixAt(slot, mat);
    };

    const world = new Vector3();
    const linePts: number[] = [];
    let nSel = 0;
    let nUnsel = 0;
    let nKnob = 0;
    for (let i = 0; i < data.points.length; i++) {
      const p = data.points[i]!;
      world.set(...p.position).applyMatrix4(object.matrixWorld);
      if (selected.has(i)) {
        compose(this.anchorsSel, nSel++, world.clone(), ANCHOR_PX);
        for (const h of [p.inHandle, p.outHandle]) {
          if (h[0] === 0 && h[1] === 0 && h[2] === 0) continue;
          const tipLocal: [number, number, number] = [
            p.position[0] + h[0],
            p.position[1] + h[1],
            p.position[2] + h[2],
          ];
          linePts.push(...p.position, ...tipLocal);
          const tipWorld = new Vector3(...tipLocal).applyMatrix4(object.matrixWorld);
          compose(this.knobs, nKnob++, tipWorld, KNOB_PX);
        }
      } else {
        compose(this.anchorsUnsel, nUnsel++, world.clone(), ANCHOR_PX);
      }
    }
    this.anchorsSel.count = nSel;
    this.anchorsUnsel.count = nUnsel;
    this.knobs.count = nKnob;
    this.anchorsSel.instanceMatrix.needsUpdate = true;
    this.anchorsUnsel.instanceMatrix.needsUpdate = true;
    this.knobs.instanceMatrix.needsUpdate = true;

    this.handleLines.geometry.dispose();
    this.handleLines.geometry = new BufferGeometry();
    this.handleLines.geometry.setAttribute(
      "position",
      new BufferAttribute(new Float32Array(linePts), 3),
    );
  }

  private activeContext(): { nodeId: Uuid; data: SplineData; object: Object3D } | null {
    if (this.doc.selection.editMode !== "point") return null;
    const active = this.doc.selection.active;
    if (!active || !this.doc.scene.has(active)) return null;
    const node = this.doc.scene.mustGet(active);
    if (node.kind !== "spline") return null;
    const data = node.data?.spline as SplineData | undefined;
    const object = this.sync.object(active);
    return data && object ? { nodeId: active, data, object } : null;
  }

  private selectedSet(nodeId: Uuid, data: SplineData): Set<number> {
    const sel = this.doc.selection.componentsFor(nodeId, "point");
    if (!sel || sel.topologyVersion !== splineStamp(data)) return new Set();
    return new Set(sel.bits.toArray());
  }
}
