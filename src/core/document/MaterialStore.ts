import type { MaterialDTO, Uuid } from "@/types/core";

/**
 * Flat material library keyed by id. Nodes reference entries via
 * `data.material`. The Document owns all mutations (so events fire and the
 * `materials` slice bumps); this is just typed storage + (de)serialization.
 */
export class MaterialStore {
  private map = new Map<Uuid, MaterialDTO>();

  get(id: Uuid): MaterialDTO | undefined {
    return this.map.get(id);
  }

  mustGet(id: Uuid): MaterialDTO {
    const m = this.map.get(id);
    if (!m) throw new Error(`MaterialStore: unknown material ${id}`);
    return m;
  }

  has(id: Uuid): boolean {
    return this.map.has(id);
  }

  /** Insert or replace (stores a copy — callers keep their own object). */
  set(mat: MaterialDTO): void {
    this.map.set(mat.id, structuredClone(mat));
  }

  delete(id: Uuid): boolean {
    return this.map.delete(id);
  }

  all(): MaterialDTO[] {
    return [...this.map.values()];
  }

  get size(): number {
    return this.map.size;
  }

  toDTO(): MaterialDTO[] {
    return this.all().map((m) => structuredClone(m));
  }

  static fromDTO(dtos: MaterialDTO[] | undefined): MaterialStore {
    const store = new MaterialStore();
    for (const d of dtos ?? []) store.map.set(d.id, structuredClone(d));
    return store;
  }
}
