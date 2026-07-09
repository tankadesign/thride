import type { SceneNodeDTO, Uuid } from "@/types/core";
import type { Document } from "@/core";
import { uniqueSiblingName } from "@/core/document/naming";
import type { Command } from "@/core/history/Command";
import { uuidv7 } from "@/core/ids/uuid";
import { HEMesh } from "@/geometry/kernel/HEMesh";
import { meshBytes, meshRegistry } from "@/geometry/store/meshRegistry";

/**
 * Deep-copy a subtree (option-drag in the object manager, duplicate).
 * Ids are remapped, converted kernel meshes are CLONED (never shared),
 * internal target references are remapped, and the copied root gets a
 * unique sibling name at the destination.
 */
export class DuplicateSubtreeCommand implements Command {
  readonly type = "scene.duplicate";
  readonly label: string;
  readonly memoryCost: number;
  readonly newRootId: Uuid;
  private readonly dtos: SceneNodeDTO[]; // parents-first, ids remapped
  private readonly index: number | undefined;
  private readonly meshes: { id: Uuid; mesh: HEMesh }[] = [];

  constructor(doc: Document, sourceId: Uuid, parent: Uuid | null, index?: number) {
    const source = doc.scene.mustGet(sourceId);
    this.label = `Copy ${source.name}`;
    this.index = index;

    // collect subtree DTOs parents-first with an id remap
    const idMap = new Map<Uuid, Uuid>();
    const dtos: SceneNodeDTO[] = [];
    const walk = (id: Uuid) => {
      idMap.set(id, uuidv7());
      dtos.push(doc.scene.mustGet(id).toDTO());
      for (const c of doc.scene.childrenOf(id)) walk(c);
    };
    walk(sourceId);

    let bytes = 0;
    this.dtos = dtos.map((dto, i) => {
      const copy = structuredClone(dto);
      copy.id = idMap.get(dto.id)!;
      copy.parent = i === 0 ? parent : (idMap.get(dto.parent!) ?? dto.parent);
      if (copy.data) {
        // clone converted kernel meshes so copies never share editable data
        const meshRef = copy.data.mesh as { id: Uuid } | undefined;
        const sourceMesh = meshRef ? meshRegistry.get(meshRef.id) : undefined;
        if (meshRef && sourceMesh) {
          const newMeshId = uuidv7();
          const mesh = HEMesh.fromSnapshot(sourceMesh.snapshot());
          this.meshes.push({ id: newMeshId, mesh });
          bytes += meshBytes(mesh);
          copy.data.mesh = { id: newMeshId };
        }
        // remap targets pointing INSIDE the copied subtree
        const target = copy.data.target as Uuid | undefined;
        if (target && idMap.has(target)) copy.data.target = idMap.get(target);
      }
      return copy;
    });
    this.dtos[0]!.name = uniqueSiblingName(doc, parent, this.dtos[0]!.name);
    this.newRootId = this.dtos[0]!.id;
    this.memoryCost = bytes + 1024;
  }

  execute(doc: Document): void {
    for (const { id, mesh } of this.meshes) meshRegistry.register(id, mesh);
    this.dtos.forEach((dto, i) => {
      doc.restoreNode(dto, i === 0 ? this.index : undefined);
    });
  }

  undo(doc: Document): void {
    doc.removeNode(this.newRootId);
    for (const { id } of this.meshes) meshRegistry.unregister(id);
  }
}
