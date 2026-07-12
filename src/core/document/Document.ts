import type {
  DocEventMap,
  MaterialDTO,
  NodeKind,
  SceneNodeDTO,
  SliceId,
  ThrideDocumentDTO,
  TransformDTO,
  Uuid,
} from "@/types/core";
import { FORMAT_VERSION } from "@/types/core";
import { EventBus } from "@/core/events/EventBus";
import { History } from "@/core/history/History";
import { Selection } from "@/core/selection/Selection";
import { SessionRunner } from "@/core/session/InteractiveSession";
import { MaterialStore } from "./MaterialStore";
import { SceneNode } from "./SceneNode";
import { SceneStore } from "./SceneStore";

/**
 * The single source of truth for one open project. Everything rendered
 * (Three scene) or displayed (React panels) is a projection of this.
 *
 * All mutations MUST go through Document methods so events fire and slice
 * versions bump. User-visible mutations additionally flow through
 * this.history (run/transact) so they are undoable; Document methods stay
 * event-emitting primitives that Commands call.
 */
export class Document {
  scene = new SceneStore();
  materials = new MaterialStore();
  readonly events = new EventBus<DocEventMap>();
  readonly history = new History(this, () => {
    this.bump("history");
    this.events.emit("history:changed", {
      canUndo: this.history.canUndo,
      canRedo: this.history.canRedo,
    });
  });
  readonly selection = new Selection(() => {
    this.bump("selection");
    this.events.emit("selection:changed", {});
  });
  readonly sessions = new SessionRunner(this);
  private versions: Record<SliceId, number> = {
    scene: 0,
    selection: 0,
    meshes: 0,
    materials: 0,
    animation: 0,
    settings: 0,
    history: 0,
  };

  private sliceListeners = new Map<SliceId, Set<() => void>>();

  /** Monotonic per-slice counter; useSyncExternalStore snapshots compare these. */
  version(slice: SliceId): number {
    return this.versions[slice];
  }

  /**
   * Subscribe to bumps of one slice (React binding surface — see
   * ui/hooks/doc/document). Returns an unsubscribe function.
   */
  subscribeSlice(slice: SliceId, cb: () => void): () => void {
    let set = this.sliceListeners.get(slice);
    if (!set) {
      set = new Set();
      this.sliceListeners.set(slice, set);
    }
    set.add(cb);
    return () => set.delete(cb);
  }

  private bump(slice: SliceId): void {
    this.versions[slice]++;
    const set = this.sliceListeners.get(slice);
    if (set) for (const cb of [...set]) cb();
  }

  // ---- scene mutations -------------------------------------------------

  createNode(kind: NodeKind, name: string, parent: Uuid | null = null, index?: number): SceneNode {
    const node = new SceneNode(kind, name);
    this.scene.add(node, parent, index);
    this.bump("scene");
    this.events.emit("scene:node-added", { id: node.id });
    return node;
  }

  /** Re-insert a previously serialized node (undo of delete, paste). */
  restoreNode(dto: SceneNodeDTO, index?: number): SceneNode {
    const node = SceneNode.fromDTO(dto);
    this.scene.add(node, dto.parent, index);
    this.bump("scene");
    this.events.emit("scene:node-added", { id: node.id });
    return node;
  }

  removeNode(id: Uuid): SceneNodeDTO[] {
    const parent = this.scene.mustGet(id).parent;
    const removed = this.scene.removeSubtree(id).map((n) => n.toDTO());
    for (const dto of removed) this.selection.pruneObject(dto.id);
    this.bump("scene");
    this.events.emit("scene:node-removed", { id, parent });
    return removed;
  }

  reparentNode(id: Uuid, newParent: Uuid | null, index?: number): void {
    this.scene.reparent(id, newParent, index);
    this.bump("scene");
    this.events.emit("scene:hierarchy-changed", { id });
  }

  renameNode(id: Uuid, name: string): void {
    this.scene.mustGet(id).name = name;
    this.bump("scene");
    this.events.emit("scene:node-changed", { id });
  }

  setNodeTransform(id: Uuid, transform: TransformDTO, preview = false): void {
    const node = this.scene.mustGet(id);
    node.transform = {
      position: [...transform.position],
      rotation: [...transform.rotation],
      scale: [...transform.scale],
    };
    this.bump("scene");
    this.events.emit("scene:node-changed", { id, preview });
  }

  /** Replace the kind-specific data payload (primitive params etc). */
  setNodeData(id: Uuid, data: Record<string, unknown> | undefined, preview = false): void {
    const node = this.scene.mustGet(id);
    node.data = data ? structuredClone(data) : undefined;
    this.bump("scene");
    this.events.emit("scene:node-changed", { id, preview });
  }

  /**
   * Notify that a node's EXTERNAL payload changed (registry-backed kernel
   * mesh edits) without rewriting node data — bumps the scene slice and
   * emits node-changed so render/UI resync. Preview-tagged during drags.
   */
  touchNode(id: Uuid, preview = false): void {
    this.scene.mustGet(id); // throw on unknown node
    this.bump("scene");
    this.events.emit("scene:node-changed", { id, preview });
  }

  setNodeFlags(id: Uuid, flags: { visible?: boolean; locked?: boolean }): void {
    const node = this.scene.mustGet(id);
    if (flags.visible !== undefined) node.visible = flags.visible;
    if (flags.locked !== undefined) node.locked = flags.locked;
    this.bump("scene");
    this.events.emit("scene:node-changed", { id: node.id });
  }

  // ---- material mutations ----------------------------------------------

  /** Add (or replace) a library material. Commands call this; UI goes via history. */
  addMaterial(mat: MaterialDTO): void {
    this.materials.set(mat);
    this.bump("materials");
    this.events.emit("material:added", { id: mat.id });
  }

  /** Replace a material's data in place; `preview` marks scrub updates. */
  updateMaterial(mat: MaterialDTO, preview = false): void {
    this.materials.set(mat);
    this.bump("materials");
    this.events.emit("material:changed", { id: mat.id, preview });
  }

  removeMaterial(id: Uuid): void {
    this.materials.delete(id);
    this.bump("materials");
    this.events.emit("material:removed", { id });
  }

  // ---- serialization ---------------------------------------------------

  toDTO(): ThrideDocumentDTO {
    return {
      formatVersion: FORMAT_VERSION,
      nodes: this.scene.toDTO(),
      materials: this.materials.toDTO(),
    };
  }

  /** Replace all content from a DTO (open file). Clears undo history, emits document:reset. */
  loadDTO(dto: ThrideDocumentDTO): void {
    this.scene = SceneStore.fromDTO(dto.nodes);
    this.materials = MaterialStore.fromDTO(dto.materials);
    this.history.clear();
    this.bump("scene");
    this.bump("materials");
    this.bump("selection");
    this.events.emit("document:reset", {});
  }
}
