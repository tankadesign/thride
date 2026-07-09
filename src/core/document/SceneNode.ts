import type { NodeKind, SceneNodeDTO, TransformDTO, Uuid } from "@/types/core";
import { identityTransform } from "@/types/core";
import { uuidv7 } from "@/core/ids/uuid";

const cloneTransform = (t: TransformDTO): TransformDTO => ({
  position: [...t.position],
  rotation: [...t.rotation],
  scale: [...t.scale],
});

/**
 * Runtime scene-hierarchy node. Pure data + (de)serialization; hierarchy
 * links live in SceneStore. Mutations go through Document methods so events
 * and version bumps always fire.
 */
export class SceneNode {
  readonly id: Uuid;
  name: string;
  readonly kind: NodeKind;
  parent: Uuid | null = null;
  transform: TransformDTO;
  visible = true;
  locked = false;
  /** Kind-specific payload; preserved verbatim for forward compatibility. */
  data: Record<string, unknown> | undefined;

  constructor(kind: NodeKind, name: string, id: Uuid = uuidv7()) {
    this.id = id;
    this.kind = kind;
    this.name = name;
    this.transform = identityTransform();
  }

  static fromDTO(dto: SceneNodeDTO): SceneNode {
    const node = new SceneNode(dto.kind, dto.name, dto.id);
    node.parent = dto.parent;
    node.transform = cloneTransform(dto.transform);
    node.visible = dto.visible;
    node.locked = dto.locked;
    node.data = dto.data ? structuredClone(dto.data) : undefined;
    return node;
  }

  toDTO(): SceneNodeDTO {
    const dto: SceneNodeDTO = {
      id: this.id,
      name: this.name,
      kind: this.kind,
      parent: this.parent,
      transform: cloneTransform(this.transform),
      visible: this.visible,
      locked: this.locked,
    };
    if (this.data !== undefined) dto.data = structuredClone(this.data);
    return dto;
  }
}
