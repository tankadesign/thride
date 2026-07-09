import { Group, Mesh, MeshStandardMaterial, Object3D } from "three";
import { computeBoundsTree, disposeBoundsTree, acceleratedRaycast } from "three-mesh-bvh";
import type { Uuid } from "@/types/core";
import type { Document, SceneNode } from "@/core";
import type { PrimitiveDescriptor } from "@/types/geometry/primitives";
import { buildPrimitive } from "@/geometry/primitives";
import { RenderMesh } from "@/geometry/sync/RenderMesh";

// three-mesh-bvh accelerated raycast, wired once for the whole app
Mesh.prototype.raycast = acceleratedRaycast;
// biome-ignore lint/suspicious/noExplicitAny: prototype augmentation
(Object.getPrototypeOf(new Mesh().geometry) as any).computeBoundsTree = computeBoundsTree;
// biome-ignore lint/suspicious/noExplicitAny: prototype augmentation
(Object.getPrototypeOf(new Mesh().geometry) as any).disposeBoundsTree = disposeBoundsTree;

const BASE_MAT = new MeshStandardMaterial({ color: 0xb8b8c0, roughness: 0.65, metalness: 0.05 });
const SELECTED_MAT = new MeshStandardMaterial({
  color: 0xb8b8c0,
  roughness: 0.65,
  metalness: 0.05,
  emissive: 0x2a5cbf,
  emissiveIntensity: 0.35,
});

/**
 * Projects the Document into a Three scene graph. The Document is the
 * truth; this class only reacts to events. Mesh nodes carry
 * userData.nodeId for picking.
 */
export class SceneSynchronizer {
  readonly root = new Group();
  private objects = new Map<Uuid, Object3D>();
  private renderMeshes = new Map<Uuid, { key: string; rm: RenderMesh }>();
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
        this.updateSelectionTint();
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
    this.updateSelectionTint();
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

  private updateSelectionTint(): void {
    for (const [id, obj] of this.objects) {
      if (obj instanceof Mesh) {
        obj.material = this.doc.selection.has(id) ? SELECTED_MAT : BASE_MAT;
      }
    }
  }
}
