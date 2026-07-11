import type { Uuid } from "@/types/core";
import type { Document } from "@/core";
import type { Command } from "@/core/history/Command";
import { uuidv7 } from "@/core/ids/uuid";
import type { PrimitiveDescriptor } from "@/types/geometry/primitives";
import type { HEMesh } from "@/geometry/kernel/HEMesh";
import { buildPrimitive } from "@/geometry/primitives";
import { meshBytes, meshRegistry } from "@/geometry/store/meshRegistry";

/**
 * "Convert to Mesh" (C4D's make-editable): a parametric primitive node
 * becomes an editable kernel mesh. The node's data flips from
 * { primitive } to { mesh: { id } }; the HEMesh lives in the meshRegistry.
 * Point/edge/polygon editing of these meshes lands with chunk D4.
 */
export class ConvertToMeshCommand implements Command {
  readonly type = "geometry.convertToMesh";
  readonly label: string;
  readonly memoryCost: number;
  private readonly nodeId: Uuid;
  private readonly meshId: Uuid;
  private readonly mesh: HEMesh;
  private readonly before: Record<string, unknown>;

  /**
   * Converts a primitive node, or — when `prebuilt` is passed (generator
   * make-editable; the app layer evaluates the generator) — any node.
   * Throws if neither applies; check eligibility first.
   */
  constructor(doc: Document, nodeId: Uuid, prebuilt?: HEMesh) {
    const node = doc.scene.mustGet(nodeId);
    const desc = node.data?.primitive as PrimitiveDescriptor | undefined;
    if (!desc && !prebuilt) throw new Error("ConvertToMeshCommand: node has no primitive");
    this.nodeId = nodeId;
    this.label = `Convert ${node.name} to Mesh`;
    this.before = structuredClone(node.data ?? {});
    this.meshId = uuidv7();
    this.mesh = prebuilt ?? buildPrimitive(desc!);
    this.memoryCost = meshBytes(this.mesh);
  }

  static eligible(doc: Document, nodeId: Uuid): boolean {
    return doc.scene.has(nodeId) && doc.scene.mustGet(nodeId).data?.primitive !== undefined;
  }

  execute(doc: Document): void {
    meshRegistry.register(this.meshId, this.mesh);
    doc.setNodeData(this.nodeId, { mesh: { id: this.meshId } });
  }

  undo(doc: Document): void {
    doc.setNodeData(this.nodeId, this.before);
    meshRegistry.unregister(this.meshId);
  }
}
