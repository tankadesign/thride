import type { Material } from "three";
import type { NodeMaterial } from "three/webgpu";
import type { MaterialDTO, MaterialType, Uuid } from "@/types/core";
import { TEXTURE_CHANNELS } from "@/types/core";
import type { Document } from "@/core";
import { applyMaterialParams, buildMaterial } from "@/materials/build";
import { TextureCache } from "./textureCache";

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
  private readonly textures: TextureCache;
  /** Fallback for unassigned meshes / dangling ids (the viewport default look). */
  readonly defaultMat: Material;

  constructor(doc: Document, defaultMat: Material, onDirty: () => void = () => {}) {
    this.doc = doc;
    this.defaultMat = defaultMat;
    // a texture that decodes after the frame re-binds every channel + re-renders
    this.textures = new TextureCache(() => {
      this.reapplyTextures();
      onDirty();
    });
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
      this.applyTextures(entry.mat, dto);
    }
    return entry.mat;
  }

  /** A library material's params/type changed — update the shared material. */
  onChanged(id: Uuid): void {
    const dto = this.doc.materials.get(id);
    const entry = this.cache.get(id);
    if (!dto || !entry) return; // uncached → resolve() builds fresh with current params
    if (entry.type !== dto.type) {
      const rebuilt = { mat: buildMaterial(dto), type: dto.type };
      this.cache.set(id, rebuilt);
      this.applyTextures(rebuilt.mat, dto);
    } else {
      applyMaterialParams(entry.mat, dto);
      this.applyTextures(entry.mat, dto);
    }
  }

  /** Material deleted — drop it; meshes fall back to the default via resolve(). */
  onRemoved(id: Uuid): void {
    this.cache.delete(id);
  }

  clear(): void {
    this.cache.clear();
    this.textures.dispose();
  }

  /**
   * Bind each image-map channel to its decoded texture (or null). Adding/removing
   * a map changes the compiled shader, so `needsUpdate` is required on any change.
   * A channel whose texture is still decoding binds null now and is re-bound when
   * the cache fires ready (see the constructor).
   */
  private applyTextures(mat: NodeMaterial, dto: MaterialDTO): void {
    const m = mat as unknown as Record<string, unknown>;
    let changed = false;
    for (const { channel, applies, colorSpace } of TEXTURE_CHANNELS) {
      if (!(channel in mat)) continue;
      const id = applies.has(dto.type) ? dto.textures?.[channel] : undefined;
      const tex = id ? (this.textures.get(id, colorSpace) ?? null) : null;
      if (m[channel] !== tex) {
        m[channel] = tex;
        changed = true;
      }
    }
    if (changed) mat.needsUpdate = true;
  }

  private reapplyTextures(): void {
    for (const [id, entry] of this.cache) {
      const dto = this.doc.materials.get(id);
      if (dto) this.applyTextures(entry.mat, dto);
    }
  }
}
