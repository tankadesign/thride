import type { SceneNodeDTO, Uuid } from "@/types/core";
import { SceneNode } from "./SceneNode";

const ROOT = null;

/**
 * Flat node storage + hierarchy indices. Enforces structural invariants
 * (existing parents, no cycles, consistent child order); does NOT emit
 * events — Document wraps every mutation and owns eventing.
 */
export class SceneStore {
  private nodes = new Map<Uuid, SceneNode>();
  private childIds = new Map<Uuid | null, Uuid[]>([[ROOT, []]]);

  get(id: Uuid): SceneNode | undefined {
    return this.nodes.get(id);
  }

  mustGet(id: Uuid): SceneNode {
    const node = this.nodes.get(id);
    if (!node) throw new Error(`SceneStore: unknown node ${id}`);
    return node;
  }

  has(id: Uuid): boolean {
    return this.nodes.has(id);
  }

  get size(): number {
    return this.nodes.size;
  }

  rootIds(): readonly Uuid[] {
    return this.childIds.get(ROOT)!;
  }

  childrenOf(id: Uuid | null): readonly Uuid[] {
    return this.childIds.get(id) ?? [];
  }

  /** True if `ancestorId` is `id` itself or one of its ancestors. */
  isAncestorOrSelf(ancestorId: Uuid, id: Uuid): boolean {
    let cur: Uuid | null = id;
    while (cur !== null) {
      if (cur === ancestorId) return true;
      cur = this.mustGet(cur).parent;
    }
    return false;
  }

  /** Insert an existing node under `parent` (null = root) at `index` (append by default). */
  add(node: SceneNode, parent: Uuid | null = ROOT, index?: number): void {
    if (this.nodes.has(node.id)) throw new Error(`SceneStore: duplicate id ${node.id}`);
    if (parent !== null && !this.nodes.has(parent)) {
      throw new Error(`SceneStore: parent ${parent} not found`);
    }
    this.nodes.set(node.id, node);
    node.parent = parent;
    this.childIds.set(node.id, []);
    this.insertChild(parent, node.id, index);
  }

  /** Remove a node and its entire subtree. Returns removed nodes, parents-first. */
  removeSubtree(id: Uuid): SceneNode[] {
    const removed: SceneNode[] = [];
    const walk = (nid: Uuid) => {
      removed.push(this.mustGet(nid));
      for (const child of this.childrenOf(nid)) walk(child);
    };
    walk(id);
    this.detachChild(this.mustGet(id).parent, id);
    for (const node of removed) {
      this.nodes.delete(node.id);
      this.childIds.delete(node.id);
    }
    return removed;
  }

  /** Move a node under a new parent/index. Rejects cycles (parenting under own subtree). */
  reparent(id: Uuid, newParent: Uuid | null, index?: number): void {
    const node = this.mustGet(id);
    if (newParent !== null) {
      this.mustGet(newParent);
      if (this.isAncestorOrSelf(id, newParent)) {
        throw new Error(`SceneStore: cannot parent ${id} under its own subtree`);
      }
    }
    this.detachChild(node.parent, id);
    node.parent = newParent;
    this.insertChild(newParent, id, index);
  }

  /** Serialize as a flat DFS list — parents always precede descendants. */
  toDTO(): SceneNodeDTO[] {
    const out: SceneNodeDTO[] = [];
    const walk = (id: Uuid) => {
      out.push(this.mustGet(id).toDTO());
      for (const child of this.childrenOf(id)) walk(child);
    };
    for (const root of this.rootIds()) walk(root);
    return out;
  }

  /** Rebuild from a flat DTO list (parents must precede children, as toDTO guarantees). */
  static fromDTO(dtos: readonly SceneNodeDTO[]): SceneStore {
    const store = new SceneStore();
    for (const dto of dtos) {
      store.add(SceneNode.fromDTO(dto), dto.parent);
    }
    return store;
  }

  private insertChild(parent: Uuid | null, id: Uuid, index?: number): void {
    const siblings = this.childIds.get(parent);
    if (!siblings) throw new Error(`SceneStore: parent ${String(parent)} has no child list`);
    if (index === undefined || index < 0 || index >= siblings.length) {
      siblings.push(id);
    } else {
      siblings.splice(index, 0, id);
    }
  }

  private detachChild(parent: Uuid | null, id: Uuid): void {
    const siblings = this.childIds.get(parent);
    if (!siblings) return;
    const i = siblings.indexOf(id);
    if (i !== -1) siblings.splice(i, 1);
  }
}
