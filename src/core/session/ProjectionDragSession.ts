import type { MaterialDTO, ProjectionTransform, TextureChannel, Uuid } from "@/types/core";
import type { Document } from "@/core/document/Document";
import type { Command } from "@/core/history/Command";
import { UpdateMaterialCommand } from "@/core/history/commands/material";
import type { InteractiveSession } from "./InteractiveSession";

/**
 * Viewport "Texture" mode drag: the TRS gizmo edits one image channel's
 * projection placement (offset / rotation / scale) on a material, live. Input
 * is the new {@link ProjectionTransform}; each preview update pokes the
 * projection's uniform nodes (no recompile), and commit collapses the drag
 * into one undoable {@link UpdateMaterialCommand} against the begin snapshot.
 */
export class ProjectionDragSession implements InteractiveSession<ProjectionTransform> {
  readonly label = "Edit Projection";
  private readonly materialId: Uuid;
  private readonly channel: TextureChannel;
  private before: MaterialDTO | null = null;

  constructor(materialId: Uuid, channel: TextureChannel) {
    this.materialId = materialId;
    this.channel = channel;
  }

  begin(doc: Document): void {
    const mat = doc.materials.get(this.materialId);
    this.before = mat ? structuredClone(mat) : null;
  }

  update(doc: Document, transform: ProjectionTransform): void {
    const mat = doc.materials.get(this.materialId);
    if (!mat) return;
    doc.updateMaterial(
      {
        ...mat,
        textureProjectionTransforms: {
          ...mat.textureProjectionTransforms,
          [this.channel]: transform,
        },
      },
      true, // preview: pokes the projection uniforms, no recompile
    );
  }

  commit(doc: Document): Command | null {
    const before = this.before;
    const after = doc.materials.get(this.materialId);
    if (!before || !after) return null;
    if (JSON.stringify(before) === JSON.stringify(after)) return null;
    return new UpdateMaterialCommand(before, structuredClone(after), "Edit Projection");
  }

  cancel(doc: Document): void {
    if (this.before) doc.updateMaterial(structuredClone(this.before));
  }
}
