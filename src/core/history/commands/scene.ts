import type { NodeKind, SceneNodeDTO, TransformDTO, Uuid } from "@/types/core";
import { identityTransform } from "@/types/core";
import { uuidv7 } from "@/core/ids/uuid";
import type { Document } from "@/core/document/Document";
import type { Command } from "../Command";

/**
 * Undoable commands for scene-hierarchy operations. Each captures plain DTO
 * data up front (or on first execute) so redo replays deterministically with
 * stable ids.
 */

export class CreateNodeCommand implements Command {
  readonly type = "scene.createNode";
  readonly label: string;
  /** Known before execute so callers can select/parent the node they create. */
  readonly nodeId: Uuid;
  private readonly dto: SceneNodeDTO;
  private readonly index: number | undefined;

  constructor(
    kind: NodeKind,
    name: string,
    parent: Uuid | null = null,
    index?: number,
    data?: Record<string, unknown>,
    transform?: TransformDTO,
  ) {
    this.label = `Create ${name}`;
    this.index = index;
    this.dto = {
      id: uuidv7(),
      name,
      kind,
      parent,
      transform: transform ? structuredClone(transform) : identityTransform(),
      visible: true,
      locked: false,
    };
    if (data) this.dto.data = structuredClone(data);
    this.nodeId = this.dto.id;
  }

  execute(doc: Document): void {
    doc.restoreNode(this.dto, this.index);
  }

  undo(doc: Document): void {
    doc.removeNode(this.nodeId);
  }
}

export class RemoveNodeCommand implements Command {
  readonly type = "scene.removeNode";
  readonly label = "Delete";
  private removed: SceneNodeDTO[] = [];
  private siblingIndex = 0;
  private readonly nodeId: Uuid;

  constructor(nodeId: Uuid) {
    this.nodeId = nodeId;
  }

  execute(doc: Document): void {
    const parent = doc.scene.mustGet(this.nodeId).parent;
    this.siblingIndex = doc.scene.childrenOf(parent).indexOf(this.nodeId);
    this.removed = doc.removeNode(this.nodeId);
  }

  undo(doc: Document): void {
    // parents-first order; the subtree root goes back to its sibling slot
    this.removed.forEach((dto, i) => {
      doc.restoreNode(dto, i === 0 ? this.siblingIndex : undefined);
    });
  }
}

export class ReparentNodeCommand implements Command {
  readonly type = "scene.reparent";
  readonly label = "Reparent";
  private oldParent: Uuid | null = null;
  private oldIndex = 0;
  private readonly nodeId: Uuid;
  private readonly newParent: Uuid | null;
  private readonly newIndex: number | undefined;

  constructor(nodeId: Uuid, newParent: Uuid | null, newIndex?: number) {
    this.nodeId = nodeId;
    this.newParent = newParent;
    this.newIndex = newIndex;
  }

  execute(doc: Document): void {
    const node = doc.scene.mustGet(this.nodeId);
    this.oldParent = node.parent;
    this.oldIndex = doc.scene.childrenOf(node.parent).indexOf(this.nodeId);
    doc.reparentNode(this.nodeId, this.newParent, this.newIndex);
  }

  undo(doc: Document): void {
    doc.reparentNode(this.nodeId, this.oldParent, this.oldIndex);
  }
}

export class RenameNodeCommand implements Command {
  readonly type = "scene.rename";
  readonly label: string;
  private oldName = "";
  private readonly nodeId: Uuid;
  private readonly newName: string;

  constructor(nodeId: Uuid, newName: string) {
    this.nodeId = nodeId;
    this.newName = newName;
    this.label = `Rename to ${newName}`;
  }

  execute(doc: Document): void {
    this.oldName = doc.scene.mustGet(this.nodeId).name;
    doc.renameNode(this.nodeId, this.newName);
  }

  undo(doc: Document): void {
    doc.renameNode(this.nodeId, this.oldName);
  }
}

const cloneTransform = (t: TransformDTO): TransformDTO => ({
  position: [...t.position],
  rotation: [...t.rotation],
  scale: [...t.scale],
});

export class SetTransformCommand implements Command {
  readonly type = "scene.setTransform";
  readonly label = "Transform";
  private before: TransformDTO | null = null;
  private after: TransformDTO;

  /**
   * `before` is captured lazily on first execute — EXCEPT for interactive
   * commits (pushWithoutExecute), where the state is already mutated and the
   * session must pass the value it captured at begin().
   */
  readonly nodeId: Uuid;

  constructor(nodeId: Uuid, after: TransformDTO, before?: TransformDTO) {
    this.nodeId = nodeId;
    this.after = cloneTransform(after);
    if (before) this.before = cloneTransform(before);
  }

  execute(doc: Document): void {
    this.before ??= cloneTransform(doc.scene.mustGet(this.nodeId).transform);
    doc.setNodeTransform(this.nodeId, this.after);
  }

  undo(doc: Document): void {
    if (this.before) doc.setNodeTransform(this.nodeId, this.before);
  }

  /** Consecutive transform tweaks on the same node collapse into one step. */
  tryMerge(next: Command): boolean {
    if (!(next instanceof SetTransformCommand) || next.nodeId !== this.nodeId) return false;
    this.after = next.after;
    return true;
  }
}

export class SetNodeDataCommand implements Command {
  readonly type = "scene.setData";
  readonly label: string;
  private before: Record<string, unknown> | undefined | null = null;
  private after: Record<string, unknown> | undefined;
  private readonly nodeId: Uuid;
  private readonly mergeable: boolean;

  /**
   * Pass `before` explicitly when committing an interactive scrub. Pass
   * `mergeable: false` for discrete user actions (pen points, tangent ops)
   * that must stay individual undo steps even inside the merge window.
   */
  constructor(
    nodeId: Uuid,
    after: Record<string, unknown> | undefined,
    before?: Record<string, unknown>,
    label = "Edit Parameters",
    mergeable = true,
  ) {
    this.nodeId = nodeId;
    this.after = after ? structuredClone(after) : undefined;
    if (before !== undefined) this.before = structuredClone(before);
    this.label = label;
    this.mergeable = mergeable;
  }

  execute(doc: Document): void {
    if (this.before === null) {
      const cur = doc.scene.mustGet(this.nodeId).data;
      this.before = cur ? structuredClone(cur) : undefined;
    }
    doc.setNodeData(this.nodeId, this.after);
  }

  undo(doc: Document): void {
    doc.setNodeData(this.nodeId, this.before ?? undefined);
  }

  tryMerge(next: Command): boolean {
    if (!(next instanceof SetNodeDataCommand) || next.nodeId !== this.nodeId) return false;
    if (!this.mergeable || !next.mergeable) return false;
    this.after = next.after;
    return true;
  }
}

export class SetFlagsCommand implements Command {
  readonly type = "scene.setFlags";
  readonly label = "Toggle";
  private before: { visible: boolean; locked: boolean } | null = null;
  private readonly nodeId: Uuid;
  private readonly flags: { visible?: boolean; locked?: boolean };

  constructor(nodeId: Uuid, flags: { visible?: boolean; locked?: boolean }) {
    this.nodeId = nodeId;
    this.flags = flags;
  }

  execute(doc: Document): void {
    const node = doc.scene.mustGet(this.nodeId);
    this.before ??= { visible: node.visible, locked: node.locked };
    doc.setNodeFlags(this.nodeId, this.flags);
  }

  undo(doc: Document): void {
    if (this.before) doc.setNodeFlags(this.nodeId, this.before);
  }
}
