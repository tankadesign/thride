import type {
  DocEventMap,
  NodeKind,
  SceneNodeDTO,
  SliceId,
  ThrideDocumentDTO,
  TransformDTO,
  Uuid,
} from "@/types/core";
import { FORMAT_VERSION } from "@/types/core";
import { EventBus } from "@/core/events/EventBus";
import { SceneNode } from "./SceneNode";
import { SceneStore } from "./SceneStore";

/**
 * The single source of truth for one open project. Everything rendered
 * (Three scene) or displayed (React panels) is a projection of this.
 *
 * All mutations MUST go through Document methods so events fire and slice
 * versions bump; History (chunk B2) will wrap these methods in Commands.
 */
export class Document {
  scene = new SceneStore();
  readonly events = new EventBus<DocEventMap>();
  private versions: Record<SliceId, number> = {
    scene: 0,
    selection: 0,
    meshes: 0,
    materials: 0,
    animation: 0,
    settings: 0,
  };

  /** Monotonic per-slice counter; useSyncExternalStore snapshots compare these. */
  version(slice: SliceId): number {
    return this.versions[slice];
  }

  private bump(slice: SliceId): void {
    this.versions[slice]++;
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

  setNodeFlags(id: Uuid, flags: { visible?: boolean; locked?: boolean }): void {
    const node = this.scene.mustGet(id);
    if (flags.visible !== undefined) node.visible = flags.visible;
    if (flags.locked !== undefined) node.locked = flags.locked;
    this.bump("scene");
    this.events.emit("scene:node-changed", { id: node.id });
  }

  // ---- serialization ---------------------------------------------------

  toDTO(): ThrideDocumentDTO {
    return {
      formatVersion: FORMAT_VERSION,
      nodes: this.scene.toDTO(),
    };
  }

  /** Replace all content from a DTO (open file). Emits document:reset. */
  loadDTO(dto: ThrideDocumentDTO): void {
    this.scene = SceneStore.fromDTO(dto.nodes);
    this.bump("scene");
    this.bump("selection");
    this.events.emit("document:reset", {});
  }
}
