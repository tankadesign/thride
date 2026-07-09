import {
  BackSide,
  type Camera,
  Group,
  MathUtils,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  OrthographicCamera,
  PerspectiveCamera,
  Vector3,
} from "three";
import { MeshBasicNodeMaterial } from "three/webgpu";
import { computeBoundsTree, disposeBoundsTree, acceleratedRaycast } from "three-mesh-bvh";
import type { Uuid } from "@/types/core";
import type { Document, SceneNode } from "@/core";
import type { PrimitiveDescriptor } from "@/types/geometry/primitives";
import { buildPrimitive } from "@/geometry/primitives";
import { RenderMesh } from "@/geometry/sync/RenderMesh";
import { normalLocal, positionLocal, uniform } from "@/materials/tsl";
import { themeColor } from "./themeColor";

// three-mesh-bvh accelerated raycast, wired once for the whole app
Mesh.prototype.raycast = acceleratedRaycast;
// biome-ignore lint/suspicious/noExplicitAny: prototype augmentation
(Object.getPrototypeOf(new Mesh().geometry) as any).computeBoundsTree = computeBoundsTree;
// biome-ignore lint/suspicious/noExplicitAny: prototype augmentation
(Object.getPrototypeOf(new Mesh().geometry) as any).disposeBoundsTree = disposeBoundsTree;

const BASE_MAT = new MeshStandardMaterial({ color: 0xb8b8c0, roughness: 0.65, metalness: 0.05 });
const OUTLINE_PX = 2;

interface OutlineEntry {
  mesh: Mesh;
  offset: { value: number }; // uniform node driving the normal expansion
}

/**
 * Projects the Document into a Three scene graph. The Document is the
 * truth; this class only reacts to events. Mesh nodes carry
 * userData.nodeId for picking.
 */
export class SceneSynchronizer {
  readonly root = new Group();
  private objects = new Map<Uuid, Object3D>();
  private renderMeshes = new Map<Uuid, { key: string; rm: RenderMesh }>();
  private outlines = new Map<Uuid, OutlineEntry>();
  private readonly outlineColor = themeColor("--color-primary", "#ff865b");
  private readonly doc: Document;
  private readonly onDirty: () => void;
  private unsubs: (() => void)[] = [];

  constructor(doc: Document, onDirty: () => void) {
    this.doc = doc;
    this.onDirty = onDirty;
    this.root.name = "thride-document";
    this.unsubs.push(
      doc.events.on("scene:node-added", ({ id }) => {
        this.addNode(id);
        this.onDirty();
      }),
      doc.events.on("scene:node-removed", ({ id }) => {
        this.removeNode(id);
        this.onDirty();
      }),
      doc.events.on("scene:node-changed", ({ id }) => {
        this.updateNode(id);
        this.onDirty();
      }),
      doc.events.on("scene:hierarchy-changed", ({ id }) => {
        this.reparent(id);
        this.onDirty();
      }),
      doc.events.on("selection:changed", () => {
        this.updateSelectionOutlines();
        this.onDirty();
      }),
      doc.events.on("document:reset", () => {
        this.rebuildAll();
        this.onDirty();
      }),
    );
    this.rebuildAll();
  }

  object(id: Uuid): Object3D | undefined {
    return this.objects.get(id);
  }

  nodeIdOf(obj: Object3D): Uuid | null {
    let cur: Object3D | null = obj;
    while (cur) {
      if (cur.userData.nodeId) return cur.userData.nodeId as Uuid;
      cur = cur.parent;
    }
    return null;
  }

  dispose(): void {
    for (const u of this.unsubs) u();
    for (const { rm } of this.renderMeshes.values()) rm.dispose();
    this.renderMeshes.clear();
    this.objects.clear();
    this.root.clear();
  }

  private rebuildAll(): void {
    this.root.clear();
    this.objects.clear();
    const walk = (id: Uuid) => {
      this.addNode(id);
      for (const c of this.doc.scene.childrenOf(id)) walk(c);
    };
    for (const r of this.doc.scene.rootIds()) walk(r);
    this.outlines.clear(); // objects were rebuilt; stale outline children are gone with them
    this.updateSelectionOutlines();
  }

  private addNode(id: Uuid): void {
    if (this.objects.has(id)) return;
    const node = this.doc.scene.mustGet(id);
    const obj: Object3D = node.kind === "mesh" ? this.buildMeshObject(node) : new Group();
    obj.name = node.name;
    obj.userData.nodeId = id;
    this.objects.set(id, obj);
    this.applyTransform(node, obj);
    const parent = node.parent ? this.objects.get(node.parent) : undefined;
    (parent ?? this.root).add(obj);
  }

  private removeNode(id: Uuid): void {
    // subtree children were pruned from the document already; three children
    // of this object are stale projections — drop the whole subtree
    const obj = this.objects.get(id);
    if (!obj) return;
    obj.removeFromParent();
    obj.traverse((o) => {
      const nid = o.userData.nodeId as Uuid | undefined;
      if (nid) {
        this.objects.delete(nid);
        this.dropRenderMesh(nid);
      }
    });
  }

  private reparent(id: Uuid): void {
    const obj = this.objects.get(id);
    const node = this.doc.scene.mustGet(id);
    if (!obj) return;
    const parent = node.parent ? this.objects.get(node.parent) : undefined;
    (parent ?? this.root).add(obj);
    // sibling order is irrelevant for rendering; object manager reads the doc
  }

  private updateNode(id: Uuid): void {
    const obj = this.objects.get(id);
    if (!obj) return;
    const node = this.doc.scene.mustGet(id);
    obj.name = node.name;
    obj.visible = node.visible;
    this.applyTransform(node, obj);
    if (node.kind === "mesh" && obj instanceof Mesh) {
      const desc = node.data?.primitive as PrimitiveDescriptor | undefined;
      if (desc) {
        const key = JSON.stringify(desc);
        const entry = this.renderMeshes.get(id);
        if (!entry || entry.key !== key) {
          const rm = entry?.rm ?? new RenderMesh();
          rm.sync(buildPrimitive(desc));
          // biome-ignore lint/suspicious/noExplicitAny: bvh extension
          (rm.geometry as any).computeBoundsTree?.();
          this.renderMeshes.set(id, { key, rm });
          obj.geometry = rm.geometry;
          const outline = this.outlines.get(id);
          if (outline) outline.mesh.geometry = rm.geometry;
        }
      }
    }
  }

  private buildMeshObject(node: SceneNode): Mesh {
    const desc = (node.data?.primitive as PrimitiveDescriptor | undefined) ?? {
      type: "cube",
      params: { width: 1, height: 1, depth: 1 },
    };
    const rm = new RenderMesh();
    rm.sync(buildPrimitive(desc as PrimitiveDescriptor));
    // biome-ignore lint/suspicious/noExplicitAny: bvh extension
    (rm.geometry as any).computeBoundsTree?.();
    this.renderMeshes.set(node.id, { key: JSON.stringify(desc), rm });
    const mesh = new Mesh(rm.geometry, BASE_MAT);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    return mesh;
  }

  private dropRenderMesh(id: Uuid): void {
    const entry = this.renderMeshes.get(id);
    if (entry) {
      entry.rm.dispose();
      this.renderMeshes.delete(id);
    }
  }

  private applyTransform(node: SceneNode, obj: Object3D): void {
    const t = node.transform;
    obj.position.set(t.position[0], t.position[1], t.position[2]);
    obj.rotation.set(t.rotation[0], t.rotation[1], t.rotation[2], "XYZ");
    obj.scale.set(t.scale[0], t.scale[1], t.scale[2]);
  }

  /** 2px primary-color silhouette: backface hull expanded along normals. */
  private updateSelectionOutlines(): void {
    // drop outlines for deselected/removed nodes
    for (const [id, entry] of [...this.outlines]) {
      if (!this.doc.selection.has(id) || !this.objects.has(id)) {
        entry.mesh.removeFromParent();
        (entry.mesh.material as MeshBasicNodeMaterial).dispose();
        this.outlines.delete(id);
      }
    }
    // add outlines for newly selected mesh nodes
    for (const id of this.doc.selection.objectIds) {
      if (this.outlines.has(id)) continue;
      const obj = this.objects.get(id);
      if (!(obj instanceof Mesh)) continue;
      const offset = uniform(0.01);
      const mat = new MeshBasicNodeMaterial();
      mat.color.copy(this.outlineColor);
      mat.side = BackSide;
      mat.positionNode = positionLocal.add(normalLocal.mul(offset));
      const outline = new Mesh(obj.geometry, mat);
      outline.raycast = () => {}; // never pickable
      outline.userData.outline = true;
      outline.renderOrder = -1; // hull first, real surface wins the depth test
      obj.add(outline);
      this.outlines.set(id, { mesh: outline, offset });
    }
  }

  /**
   * Keep outlines exactly OUTLINE_PX thick for this pane's camera. Called
   * per pane before rendering (world units per pixel depend on the camera).
   */
  updateOutlines(camera: Camera, viewportHeightPx: number): void {
    if (this.outlines.size === 0 || viewportHeightPx <= 0) return;
    const objPos = new Vector3();
    const objScale = new Vector3();
    for (const [id, entry] of this.outlines) {
      const obj = this.objects.get(id);
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
