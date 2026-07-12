import type { Material } from "three";
import type { NodeMaterial } from "three/webgpu";
import type { MaterialType, Uuid } from "@/types/core";
import type { Document } from "@/core";
import { applyMaterialParams, buildMaterial } from "@/materials/build";

/**
 * Render-side cache of built three materials, one per library MaterialDTO,
 * SHARED across every mesh that references it. `resolve` gives the material for
 * a node's `data.material` (or the default when unassigned / dangling). Param
 * edits apply IN PLACE (they propagate to all meshes — verified); a TYPE change
 * rebuilds a fresh material.
 *
 * NOTE: materials are not disposed on type-change/delete for now — those are
 * rare, discrete user actions, and eager disposal of a material still bound to
 * a mesh (until the next applyShading reassigns) risks a stale-GPU-resource
 * glitch. Deferred disposal is a later cleanup.
 */
export class MaterialSync {
  private cache = new Map<Uuid, { mat: NodeMaterial; type: MaterialType }>();
  private readonly doc: Document;
  /** Fallback for unassigned meshes / dangling ids (the viewport default look). */
  readonly defaultMat: Material;

  constructor(doc: Document, defaultMat: Material) {
    this.doc = doc;
    this.defaultMat = defaultMat;
  }

  /** Material for a node's assignment id (builds lazily; default when absent). */
  resolve(id: Uuid | undefined): Material {
    if (!id) return this.defaultMat;
    const dto = this.doc.materials.get(id);
    if (!dto) return this.defaultMat;
    let entry = this.cache.get(id);
    if (!entry || entry.type !== dto.type) {
      entry = { mat: buildMaterial(dto), type: dto.type };
      this.cache.set(id, entry);
    }
    return entry.mat;
  }

  /** A library material's params/type changed — update the shared material. */
  onChanged(id: Uuid): void {
    const dto = this.doc.materials.get(id);
    const entry = this.cache.get(id);
    if (!dto || !entry) return; // uncached → resolve() builds fresh with current params
    if (entry.type !== dto.type) {
      this.cache.set(id, { mat: buildMaterial(dto), type: dto.type });
    } else {
      applyMaterialParams(entry.mat, dto);
    }
  }

  /** Material deleted — drop it; meshes fall back to the default via resolve(). */
  onRemoved(id: Uuid): void {
    this.cache.delete(id);
  }

  clear(): void {
    this.cache.clear();
  }
}
