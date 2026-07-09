import type { TransformDTO, Uuid } from "@/types/core";
import type { Document } from "@/core/document/Document";
import type { Command } from "@/core/history/Command";
import { CompositeCommand } from "@/core/history/Command";
import { SetTransformCommand } from "@/core/history/commands/scene";
import type { InteractiveSession } from "./InteractiveSession";

const clone = (t: TransformDTO): TransformDTO => ({
  position: [...t.position],
  rotation: [...t.rotation],
  scale: [...t.scale],
});

const equal = (a: TransformDTO, b: TransformDTO): boolean =>
  JSON.stringify(a) === JSON.stringify(b);

/**
 * Gizmo / numeric-drag session over one or more nodes. Input is the new
 * transform per node; commit collapses everything into one undo step with
 * begin-captured `before` values.
 */
export class TransformDragSession implements InteractiveSession<ReadonlyMap<Uuid, TransformDTO>> {
  readonly label: string;
  private readonly nodeIds: readonly Uuid[];
  private before = new Map<Uuid, TransformDTO>();

  constructor(nodeIds: readonly Uuid[], label = "Transform") {
    this.nodeIds = nodeIds;
    this.label = label;
  }

  begin(doc: Document): void {
    for (const id of this.nodeIds) {
      this.before.set(id, clone(doc.scene.mustGet(id).transform));
    }
  }

  update(doc: Document, input: ReadonlyMap<Uuid, TransformDTO>): void {
    for (const [id, t] of input) {
      doc.setNodeTransform(id, t, true); // preview-tagged
    }
  }

  commit(doc: Document): Command | null {
    const commands: Command[] = [];
    for (const id of this.nodeIds) {
      const before = this.before.get(id)!;
      const after = clone(doc.scene.mustGet(id).transform);
      if (!equal(before, after)) commands.push(new SetTransformCommand(id, after, before));
    }
    if (commands.length === 0) return null;
    if (commands.length === 1) return commands[0]!;
    return new CompositeCommand(this.label, commands);
  }

  cancel(doc: Document): void {
    for (const [id, t] of this.before) {
      doc.setNodeTransform(id, t); // non-preview: real restore
    }
  }
}
