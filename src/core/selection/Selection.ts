import type { ComponentMode, EditMode, Uuid } from "@/types/core";
import { Bitset } from "./Bitset";

export type SelectOp = "replace" | "add" | "toggle";

/**
 * Component selection for one mesh node. Stamped with the mesh kernel's
 * topologyVersion — a selection is only valid for that topology; topology
 * ops must produce the follow-up selection themselves.
 */
export interface ComponentSelection {
  mode: ComponentMode;
  bits: Bitset;
  /** Click order, for order-sensitive tools (bridge, path). */
  order: number[];
  topologyVersion: number;
}

/**
 * Object + component selection and the active edit mode. Not undoable by
 * design (matches C4D/Blender); notifies via the injected onChange so
 * Document can bump the "selection" slice and emit selection:changed.
 */
export class Selection {
  private objects = new Set<Uuid>();
  private lastSelected: Uuid | null = null;
  private components = new Map<Uuid, ComponentSelection>();
  private mode: EditMode = "object";
  private readonly onChange: () => void;

  constructor(onChange: () => void) {
    this.onChange = onChange;
  }

  get editMode(): EditMode {
    return this.mode;
  }

  /** Selected object ids in insertion order. */
  get objectIds(): readonly Uuid[] {
    return [...this.objects];
  }

  /** The most recently selected object (attribute-panel focus). */
  get active(): Uuid | null {
    return this.lastSelected;
  }

  has(id: Uuid): boolean {
    return this.objects.has(id);
  }

  setEditMode(mode: EditMode): void {
    if (this.mode === mode) return;
    this.mode = mode;
    this.onChange();
  }

  selectObjects(ids: readonly Uuid[], op: SelectOp = "replace"): void {
    if (op === "replace") {
      this.objects.clear();
      for (const id of ids) this.objects.add(id);
    } else if (op === "add") {
      for (const id of ids) this.objects.add(id);
    } else {
      for (const id of ids) {
        if (this.objects.has(id)) this.objects.delete(id);
        else this.objects.add(id);
      }
    }
    const last = ids.at(-1) ?? null;
    this.lastSelected = last && this.objects.has(last) ? last : ([...this.objects].at(-1) ?? null);
    this.onChange();
  }

  clearObjects(): void {
    if (this.objects.size === 0) return;
    this.objects.clear();
    this.lastSelected = null;
    this.onChange();
  }

  /** Drop a deleted node from the selection (Document calls this on remove). */
  pruneObject(id: Uuid): void {
    const had = this.objects.delete(id);
    this.components.delete(id);
    if (this.lastSelected === id) this.lastSelected = [...this.objects].at(-1) ?? null;
    if (had) this.onChange();
  }

  componentsFor(meshNodeId: Uuid): ComponentSelection | undefined {
    return this.components.get(meshNodeId);
  }

  setComponents(meshNodeId: Uuid, sel: ComponentSelection): void {
    this.components.set(meshNodeId, sel);
    this.onChange();
  }

  clearComponents(meshNodeId?: Uuid): void {
    if (meshNodeId) this.components.delete(meshNodeId);
    else this.components.clear();
    this.onChange();
  }
}

export { Bitset };
