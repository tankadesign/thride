import { type Material, MathUtils, type Object3D } from "three";
import type { NodeMaterial } from "three/webgpu";
import type { MaterialDTO, MaterialType, PlanarReflectionDTO, Uuid } from "@/types/core";
import { TEXTURE_CHANNELS } from "@/types/core";
import type { Document } from "@/core";
import { applyMaterialParams, buildMaterial } from "@/materials/build";
import {
  materialColor,
  materialRoughness,
  mix,
  reflector,
  textureBicubic,
  uniform,
} from "@/materials/tsl";
import { TextureCache } from "./textureCache";

/** Mirror-plane normal along a local axis → reflector-target rotation (default +Z). */
const AXIS_ROTATION: Record<PlanarReflectionDTO["axis"], [number, number, number]> = {
  y: [-Math.PI / 2, 0, 0], // +Z → +Y (floor)
  x: [0, Math.PI / 2, 0], // +Z → +X (wall)
  z: [0, 0, 0],
};

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
interface PlanarEntry {
  mat: NodeMaterial;
  matId: Uuid | undefined;
  type: MaterialType | "default";
  // biome-ignore lint/suspicious/noExplicitAny: ReflectorNode type not exported
  refl: any;
  // biome-ignore lint/suspicious/noExplicitAny: TSL uniform node
  strength: any;
  axis: PlanarReflectionDTO["axis"];
}

export class MaterialSync {
  private cache = new Map<Uuid, { mat: NodeMaterial; type: MaterialType }>();
  /** Per-NODE planar-reflection material variants (each mesh mirrors its own plane). */
  private planar = new Map<Uuid, PlanarEntry>();
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

  /**
   * Per-node material variant with a planar (mirrored-camera) reflection mixed
   * into the surface color. The reflector's target (an Object3D defining the
   * mirror plane) is attached as a child of `host`, so it follows the mesh's
   * transform. Rebuilt when the base material's id/type changes; strength /
   * resolution / axis tweak live.
   */
  resolvePlanar(
    nodeId: Uuid,
    matId: Uuid | undefined,
    cfg: PlanarReflectionDTO,
    host: Object3D,
  ): Material {
    const dto = matId ? this.doc.materials.get(matId) : undefined;
    const type: MaterialType | "default" = dto?.type ?? "default";
    let e = this.planar.get(nodeId);
    if (!e || e.type !== type || e.matId !== (dto ? matId : undefined)) {
      if (e) this.disposePlanar(e);
      const refl = reflector({ resolutionScale: cfg.resolution, generateMipmaps: true });
      refl.target.name = "planar-reflector-target";
      const strength = uniform(MathUtils.clamp(cfg.strength, 0, 1));
      const mat = dto ? buildMaterial(dto) : (this.defaultMat.clone() as NodeMaterial);
      if (dto) this.applyTextures(mat, dto);
      // mirror color over the base color; mipmapped bicubic sampling blurs the
      // reflection by the material's roughness (frosted mirrors for free)
      mat.colorNode = mix(materialColor, textureBicubic(refl, materialRoughness).rgb, strength);
      e = { mat, matId: dto ? matId : undefined, type, refl, strength, axis: cfg.axis };
      this.planar.set(nodeId, e);
    }
    // live tweaks — no rebuild
    e.strength.value = MathUtils.clamp(cfg.strength, 0, 1);
    e.refl.reflector.resolutionScale = MathUtils.clamp(cfg.resolution, 0.25, 1);
    if (e.axis !== cfg.axis) {
      e.axis = cfg.axis;
      e.refl.target.rotation.set(...AXIS_ROTATION[cfg.axis]);
    }
    if (e.refl.target.parent !== host) {
      e.refl.target.rotation.set(...AXIS_ROTATION[cfg.axis]);
      host.add(e.refl.target);
    }
    return e.mat;
  }

  /** Node no longer planar-reflective (or removed) — drop its variant. No-op otherwise. */
  releasePlanar(nodeId: Uuid): void {
    const e = this.planar.get(nodeId);
    if (!e) return;
    this.disposePlanar(e);
    this.planar.delete(nodeId);
  }

  private disposePlanar(e: PlanarEntry): void {
    e.refl.target.removeFromParent();
    e.refl.dispose?.();
    e.mat.dispose();
  }

  /** A library material's params/type changed — update the shared material. */
  onChanged(id: Uuid): void {
    const dto = this.doc.materials.get(id);
    const entry = this.cache.get(id);
    if (dto) {
      // planar variants track the base material's params (type changes rebuild
      // lazily in resolvePlanar via the type compare)
      for (const e of this.planar.values()) {
        if (e.matId === id && e.type === dto.type) {
          applyMaterialParams(e.mat, dto);
          this.applyTextures(e.mat, dto);
        }
      }
    }
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
    for (const e of this.planar.values()) this.disposePlanar(e);
    this.planar.clear();
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
