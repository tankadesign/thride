import type { SceneNodeDTO, TransformDTO, Uuid } from "@/types/core";
import type { Document } from "@/core";
import type { Command } from "@/core/history/Command";
import { uuidv7 } from "@/core/ids/uuid";
import { HEMesh } from "@/geometry/kernel/HEMesh";
import { meshBytes, meshRegistry } from "@/geometry/store/meshRegistry";
import { evaluateCloner } from "../graph";

/**
 * "Convert to Objects" — the Instancer analogue of Convert-to-Mesh. Bakes an
 * Instancer's live instances into a GROUP of real, materialed clone nodes
 * (`Base`, `Base.001`, `Base.002` …, C4D/Blender-style zero-padded siblings).
 * The Instancer node (and its target/template inputs) is replaced
 * in place by the group; every clone wears the template's material and its
 * baked TRS. All clones share one registered geometry (memory-safe, matching
 * the instancing model) — editing one later affects the set until it is
 * re-converted. One undo step restores the whole Instancer.
 *
 * Guarded: converting a huge Instancer would spawn a node per clone and hang the
 * object manager, so {@link MAX_CONVERT_INSTANCES} caps it — the caller checks
 * {@link ConvertClonerToObjectsCommand.instanceCount} first and reports instead.
 */
export const MAX_CONVERT_INSTANCES = 2000;

interface CloneSpec {
  id: Uuid;
  name: string;
  transform: TransformDTO;
}

export class ConvertClonerToObjectsCommand implements Command {
  readonly type = "generator.convertToObjects";
  readonly label: string;
  readonly memoryCost: number;
  private readonly clonerId: Uuid;
  private readonly groupDto: SceneNodeDTO;
  private readonly meshId: Uuid;
  private readonly mesh: HEMesh;
  private readonly materialId: Uuid | undefined;
  private readonly clones: CloneSpec[];
  // captured on execute so undo restores the original subtree in its slot
  private removed: SceneNodeDTO[] = [];
  private siblingIndex = 0;

  constructor(doc: Document, clonerId: Uuid) {
    const node = doc.scene.mustGet(clonerId);
    const result = evaluateCloner(doc, node);
    if (!result) throw new Error("ConvertClonerToObjectsCommand: not an evaluable Instancer");
    const count = result.matrices.length / 16;
    if (count > MAX_CONVERT_INSTANCES) {
      throw new Error(`ConvertClonerToObjectsCommand: ${count} clones exceeds the cap`);
    }
    this.clonerId = clonerId;
    this.label = `Convert ${node.name} to Objects`;

    // one shared, deep-copied template geometry for every clone
    this.mesh = HEMesh.fromSnapshot(result.base.snapshot());
    this.meshId = uuidv7();
    this.memoryCost = meshBytes(this.mesh);

    // template = child[1]; inherit its name (clone base). Material follows the
    // same resolution the InstancedMesh uses: a cloner-level material overrides,
    // else the template child's own material.
    const templateId = doc.scene.childrenOf(clonerId)[1];
    const template = templateId ? doc.scene.get(templateId) : undefined;
    const baseName = template?.name ?? node.name;
    this.materialId =
      (node.data?.material as Uuid | undefined) ?? (template?.data?.material as Uuid | undefined);

    // the group replaces the Instancer, inheriting its transform + slot so the
    // baked clones (in Instancer-local space) keep their world placement
    this.groupDto = {
      id: uuidv7(),
      name: node.name,
      kind: "null",
      parent: node.parent,
      transform: structuredClone(node.transform),
      visible: true,
      locked: false,
    };

    this.clones = [];
    for (let i = 0; i < count; i++) {
      this.clones.push({
        id: uuidv7(),
        name: i === 0 ? baseName : `${baseName}.${String(i).padStart(3, "0")}`,
        transform: decomposeTRS(result.matrices, i * 16),
      });
    }
  }

  /** Whether the node is an Instancer eligible for this conversion. */
  static eligible(doc: Document, id: Uuid): boolean {
    const gen = doc.scene.get(id)?.data?.generator as { type?: string } | undefined;
    return gen?.type === "cloner";
  }

  /** Live clone count, or -1 if not an evaluable Instancer (for the guard). */
  static instanceCount(doc: Document, id: Uuid): number {
    const node = doc.scene.get(id);
    if (!node) return -1;
    const result = evaluateCloner(doc, node);
    return result ? result.matrices.length / 16 : -1;
  }

  execute(doc: Document): void {
    this.siblingIndex = doc.scene
      .childrenOf(doc.scene.mustGet(this.clonerId).parent)
      .indexOf(this.clonerId);
    this.removed = doc.removeNode(this.clonerId);
    meshRegistry.register(this.meshId, this.mesh);
    doc.restoreNode(this.groupDto, this.siblingIndex);
    for (const c of this.clones) {
      const dto: SceneNodeDTO = {
        id: c.id,
        name: c.name,
        kind: "mesh",
        parent: this.groupDto.id,
        transform: structuredClone(c.transform),
        visible: true,
        locked: false,
        data: this.materialId
          ? { mesh: { id: this.meshId }, material: this.materialId }
          : { mesh: { id: this.meshId } },
      };
      doc.restoreNode(dto);
    }
  }

  undo(doc: Document): void {
    doc.removeNode(this.groupDto.id);
    meshRegistry.unregister(this.meshId);
    // parents-first order; the Instancer root returns to its sibling slot
    this.removed.forEach((dto, i) => {
      doc.restoreNode(dto, i === 0 ? this.siblingIndex : undefined);
    });
  }
}

/**
 * Decompose a column-major 4×4 (flat, offset `o`) into a TransformDTO with
 * Euler XYZ rotation (three.js order, matching `composeTRS`). Scale is read
 * per-axis from the basis column lengths; rotation from the normalized basis.
 */
export function decomposeTRS(m: Float32Array, o: number): TransformDTO {
  const sx = Math.hypot(m[o]!, m[o + 1]!, m[o + 2]!) || 1;
  const sy = Math.hypot(m[o + 4]!, m[o + 5]!, m[o + 6]!) || 1;
  const sz = Math.hypot(m[o + 8]!, m[o + 9]!, m[o + 10]!) || 1;
  // normalized column-major 3×3 rotation r[col*3+row]
  const r00 = m[o]! / sx;
  const r01 = m[o + 4]! / sy;
  const r11 = m[o + 5]! / sy;
  const r21 = m[o + 6]! / sy;
  const r02 = m[o + 8]! / sz;
  const r12 = m[o + 9]! / sz;
  const r22 = m[o + 10]! / sz;
  // three.js Euler.setFromRotationMatrix, order "XYZ"
  const y = Math.asin(Math.max(-1, Math.min(1, r02)));
  let x: number;
  let z: number;
  if (Math.abs(r02) < 0.9999999) {
    x = Math.atan2(-r12, r22);
    z = Math.atan2(-r01, r00);
  } else {
    x = Math.atan2(r21, r11);
    z = 0;
  }
  return {
    position: [m[o + 12]!, m[o + 13]!, m[o + 14]!],
    rotation: [x, y, z],
    scale: [sx, sy, sz],
  };
}
