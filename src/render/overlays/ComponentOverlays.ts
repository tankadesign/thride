import {
  BufferAttribute,
  BufferGeometry,
  type Camera,
  Color,
  DoubleSide,
  DynamicDrawUsage,
  Group,
  InstancedMesh,
  LineBasicMaterial,
  LineSegments,
  MathUtils,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  type Object3D,
  OrthographicCamera,
  type PerspectiveCamera,
  PlaneGeometry,
  Quaternion,
  Vector3,
} from "three";
import type { ComponentMode, Uuid } from "@/types/core";
import type { Document } from "@/core";
import type { Bitset } from "@/core/selection/Bitset";
import type { HEMesh } from "@/geometry/kernel/HEMesh";
import { edgeVerts, uniqueEdges } from "@/geometry/kernel/components";
import { meshRegistry } from "@/geometry/store/meshRegistry";
import type { SceneSynchronizer } from "@/render/scene-sync/SceneSynchronizer";
import { themeColor } from "@/render/scene-sync/themeColor";

const POINT_PX = 7;
const WIRE_COLOR = new Color(0x8a93a8);
const POINT_COLOR = new Color(0xd8dce8);

function noPick(obj: Object3D): void {
  obj.raycast = () => {};
  obj.frustumCulled = false; // WebGPU line/instance culling gotchas (see helpers)
}

/**
 * Component-mode viewport overlays for the ACTIVE editable mesh: wireframe
 * (all modes, selected edges highlighted), billboarded vertex handles
 * (point mode), selected-face highlight (polygon mode). Wire + faces live
 * in mesh-local space under a group that mirrors the node's world matrix;
 * vertex handles are world-space billboards sized per pane camera.
 */
export class ComponentOverlays {
  readonly group = new Group();
  private readonly doc: Document;
  private readonly sync: SceneSynchronizer;
  private readonly selectedColor = themeColor("--color-primary", "#ff865b");
  private readonly localRoot = new Group(); // mirrors the mesh node's matrixWorld
  private wire: LineSegments;
  private faces: Mesh;
  private pointsSel: InstancedMesh;
  private pointsUnsel: InstancedMesh;
  // rebuild guards
  private built = { node: "" as string, scene: -1, selection: -1 };

  constructor(doc: Document, sync: SceneSynchronizer) {
    this.doc = doc;
    this.sync = sync;
    this.group.name = "component-overlays";
    this.group.visible = false;
    this.group.add(this.localRoot);
    this.localRoot.matrixAutoUpdate = false;

    this.wire = new LineSegments(
      new BufferGeometry(),
      new LineBasicMaterial({
        vertexColors: true,
        transparent: true,
        opacity: 0.9,
        depthTest: false,
      }),
    );
    this.wire.renderOrder = 940;
    noPick(this.wire);
    this.localRoot.add(this.wire);

    this.faces = new Mesh(
      new BufferGeometry(),
      new MeshBasicMaterial({
        color: this.selectedColor,
        transparent: true,
        opacity: 0.3,
        depthTest: false,
        side: DoubleSide,
      }),
    );
    this.faces.renderOrder = 930;
    noPick(this.faces);
    this.localRoot.add(this.faces);

    this.pointsSel = this.makePoints(this.selectedColor, 64);
    this.pointsUnsel = this.makePoints(POINT_COLOR, 64);
  }

  /** capacity = max instances; grown by recreating (InstancedMesh is fixed-size). */
  private makePoints(color: Color, capacity: number): InstancedMesh {
    const m = new InstancedMesh(
      new PlaneGeometry(1, 1),
      new MeshBasicMaterial({ color, depthTest: false, depthWrite: false, side: DoubleSide }),
      capacity,
    );
    m.instanceMatrix.setUsage(DynamicDrawUsage);
    m.renderOrder = 950;
    m.count = 0;
    noPick(m);
    this.group.add(m);
    return m;
  }

  private dropPoints(m: InstancedMesh): void {
    m.removeFromParent();
    m.geometry.dispose();
    (m.material as MeshBasicMaterial).dispose();
    m.dispose();
  }

  /** Per pane, before render: rebuild if stale, then billboard the points. */
  update(camera: Camera, paneHeightPx: number): void {
    const ctx = this.activeContext();
    if (!ctx) {
      this.group.visible = false;
      this.built.node = "";
      return;
    }
    this.group.visible = true;
    const sceneV = this.doc.version("scene");
    const selV = this.doc.version("selection");
    const nodeKey = `${ctx.nodeId}:${ctx.mode}:${ctx.mesh.topologyVersion}`;
    if (
      this.built.node !== nodeKey ||
      this.built.scene !== sceneV ||
      this.built.selection !== selV
    ) {
      this.rebuild(ctx);
      this.built = { node: nodeKey, scene: sceneV, selection: selV };
    }
    ctx.object.updateMatrixWorld();
    this.localRoot.matrix.copy(ctx.object.matrixWorld);
    if (ctx.mode === "point") this.billboardPoints(ctx, camera, paneHeightPx);
  }

  private activeContext(): {
    nodeId: Uuid;
    mode: ComponentMode;
    mesh: HEMesh;
    object: Object3D;
    bits: Bitset | null;
  } | null {
    const mode = this.doc.selection.editMode;
    if (mode === "object" || mode === "texture") return null;
    const active = this.doc.selection.active;
    if (!active || !this.doc.scene.has(active)) return null;
    const meshRef = this.doc.scene.mustGet(active).data?.mesh as { id: Uuid } | undefined;
    const mesh = meshRef ? meshRegistry.get(meshRef.id) : undefined;
    const object = this.sync.object(active);
    if (!mesh || !object) return null;
    const sel = this.doc.selection.componentsFor(active);
    const bits =
      sel && sel.mode === mode && sel.topologyVersion === mesh.topologyVersion ? sel.bits : null;
    return { nodeId: active, mode, mesh, object, bits };
  }

  // ---- geometry rebuilds ---------------------------------------------------

  private rebuild(ctx: NonNullable<ReturnType<ComponentOverlays["activeContext"]>>): void {
    this.rebuildWire(ctx);
    this.rebuildFaces(ctx);
    const pointMode = ctx.mode === "point";
    this.pointsSel.visible = pointMode;
    this.pointsUnsel.visible = pointMode;
    this.faces.visible = ctx.mode === "polygon";
  }

  private rebuildWire(ctx: { mesh: HEMesh; mode: ComponentMode; bits: Bitset | null }): void {
    const { mesh } = ctx;
    const edges = uniqueEdges(mesh);
    const positions = new Float32Array(edges.length * 6);
    const colors = new Float32Array(edges.length * 6);
    for (let i = 0; i < edges.length; i++) {
      const h = edges[i]!;
      const [a, b] = edgeVerts(mesh, h);
      positions.set(
        [
          mesh.vPos[a * 3]!,
          mesh.vPos[a * 3 + 1]!,
          mesh.vPos[a * 3 + 2]!,
          mesh.vPos[b * 3]!,
          mesh.vPos[b * 3 + 1]!,
          mesh.vPos[b * 3 + 2]!,
        ],
        i * 6,
      );
      const selected = ctx.mode === "edge" && (ctx.bits?.has(h) ?? false);
      const c = selected ? this.selectedColor : WIRE_COLOR;
      colors.set([c.r, c.g, c.b, c.r, c.g, c.b], i * 6);
    }
    this.wire.geometry.dispose();
    this.wire.geometry = new BufferGeometry();
    this.wire.geometry.setAttribute("position", new BufferAttribute(positions, 3));
    this.wire.geometry.setAttribute("color", new BufferAttribute(colors, 3));
  }

  private rebuildFaces(ctx: { nodeId: Uuid; mode: ComponentMode; bits: Bitset | null }): void {
    if (ctx.mode !== "polygon" || !ctx.bits || ctx.bits.count === 0) {
      this.faces.geometry.dispose();
      this.faces.geometry = new BufferGeometry();
      return;
    }
    const info = this.sync.renderInfoFor(ctx.nodeId);
    const src = info?.geometry.getAttribute("position");
    if (!info || !src) return;
    const tris: number[] = [];
    for (let t = 0; t < info.triFace.length; t++) {
      if (!ctx.bits.has(info.triFace[t]!)) continue;
      for (let c = 0; c < 3; c++) {
        const i = t * 3 + c;
        tris.push(src.getX(i), src.getY(i), src.getZ(i));
      }
    }
    this.faces.geometry.dispose();
    this.faces.geometry = new BufferGeometry();
    this.faces.geometry.setAttribute("position", new BufferAttribute(new Float32Array(tris), 3));
  }

  // ---- vertex billboards ---------------------------------------------------

  private billboardPoints(
    ctx: { mesh: HEMesh; object: Object3D; bits: Bitset | null },
    camera: Camera,
    paneHeightPx: number,
  ): void {
    const { mesh } = ctx;
    if (this.pointsSel.instanceMatrix.count < mesh.vCount) {
      this.dropPoints(this.pointsSel);
      this.dropPoints(this.pointsUnsel);
      this.pointsSel = this.makePoints(this.selectedColor, mesh.vCount);
      this.pointsUnsel = this.makePoints(POINT_COLOR, mesh.vCount);
    }
    const quat = new Quaternion();
    camera.getWorldQuaternion(quat);
    const ortho = camera as OrthographicCamera;
    const orthoPerPixel = ortho.isOrthographicCamera
      ? (ortho.top - ortho.bottom) / Math.max(1, paneHeightPx)
      : 0;
    const persp = camera as PerspectiveCamera;
    const camPos = new Vector3().setFromMatrixPosition(camera.matrixWorld);
    const pos = new Vector3();
    const scale = new Vector3();
    const m = new Matrix4();
    let nSel = 0;
    let nUnsel = 0;
    for (let v = 0; v < mesh.vCount; v++) {
      pos
        .set(mesh.vPos[v * 3]!, mesh.vPos[v * 3 + 1]!, mesh.vPos[v * 3 + 2]!)
        .applyMatrix4(ctx.object.matrixWorld);
      const perPixel = ortho.isOrthographicCamera
        ? orthoPerPixel
        : (2 * camPos.distanceTo(pos) * Math.tan(MathUtils.degToRad(persp.fov / 2))) /
          Math.max(1, paneHeightPx);
      scale.setScalar(Math.max(1e-6, POINT_PX * perPixel));
      m.compose(pos, quat, scale);
      if (ctx.bits?.has(v)) this.pointsSel.setMatrixAt(nSel++, m);
      else this.pointsUnsel.setMatrixAt(nUnsel++, m);
    }
    this.pointsSel.count = nSel;
    this.pointsUnsel.count = nUnsel;
    this.pointsSel.instanceMatrix.needsUpdate = true;
    this.pointsUnsel.instanceMatrix.needsUpdate = true;
  }
}
