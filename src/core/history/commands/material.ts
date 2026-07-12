import type { MaterialDTO, Uuid } from "@/types/core";
import type { Document } from "@/core/document/Document";
import type { Command } from "../Command";

/**
 * Undoable commands for the material library. Each captures plain MaterialDTOs
 * (never live three materials — the render layer owns those). Assignment of a
 * material to a node goes through SetNodeDataCommand (it's `node.data.material`).
 */

export class CreateMaterialCommand implements Command {
  readonly type = "material.create";
  readonly label: string;
  /** Known before execute so callers can select the new material. */
  readonly materialId: Uuid;
  private readonly dto: MaterialDTO;

  constructor(dto: MaterialDTO) {
    this.dto = structuredClone(dto);
    this.materialId = dto.id;
    this.label = `Create Material ${dto.name}`;
  }

  execute(doc: Document): void {
    doc.addMaterial(structuredClone(this.dto));
  }

  undo(doc: Document): void {
    doc.removeMaterial(this.materialId);
  }
}

export class UpdateMaterialCommand implements Command {
  readonly type = "material.update";
  readonly label: string;
  private readonly id: Uuid;
  private after: MaterialDTO;
  private readonly before: MaterialDTO;
  private readonly mergeable: boolean;

  constructor(before: MaterialDTO, after: MaterialDTO, label = "Edit Material", mergeable = true) {
    this.id = after.id;
    this.before = structuredClone(before);
    this.after = structuredClone(after);
    this.label = label;
    this.mergeable = mergeable;
  }

  execute(doc: Document): void {
    doc.updateMaterial(structuredClone(this.after));
  }

  undo(doc: Document): void {
    doc.updateMaterial(structuredClone(this.before));
  }

  tryMerge(next: Command): boolean {
    if (!(next instanceof UpdateMaterialCommand) || next.id !== this.id) return false;
    if (!this.mergeable || !next.mergeable) return false;
    this.after = next.after;
    return true;
  }
}

export class DeleteMaterialCommand implements Command {
  readonly type = "material.delete";
  readonly label: string;
  private readonly dto: MaterialDTO;

  constructor(dto: MaterialDTO) {
    this.dto = structuredClone(dto);
    this.label = `Delete Material ${dto.name}`;
  }

  execute(doc: Document): void {
    // nodes referencing this material keep the (now dangling) id and fall back
    // to the default material in the render layer; undo re-adds it and they
    // resolve again — no assignment bookkeeping needed.
    doc.removeMaterial(this.dto.id);
  }

  undo(doc: Document): void {
    doc.addMaterial(structuredClone(this.dto));
  }
}
