import { type Material, MathUtils, type Object3D } from "three";
import type { NodeMaterial } from "three/webgpu";
import type {
  MaterialDTO,
  MaterialType,
  PlanarReflectionDTO,
  ProceduralChannel,
  Uuid,
} from "@/types/core";
import { structureKey, TEXTURE_CHANNELS, TEXTURE_TO_PROCEDURAL } from "@/types/core";
import type { Document } from "@/core";
import { applyMaterialParams, buildMaterial } from "@/materials/build";
import type { CompiledStacks } from "@/materials/procedural";
import {
  assignChannelNodes,
  compileStacks,
  hasStacks,
  type ImageNodeCache,
  type ImageSpec,
} from "./proceduralBind";
import {
  materialColor,
  materialRoughness,
  mix,
  reflector,
  textureBicubic,
  uniform,
} from "@/materials/tsl";
import { TextureCache } from "./textureCache";

/**
 * Warm a not-yet-visible material's GPU pipeline before it is swapped in — see
 * {@link MaterialSync.setWarm}. Resolves once the shader is compiled.
 */
export type WarmFn = (mat: NodeMaterial, matId: Uuid) => Promise<void>;

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
  /** This variant's own compiled stacks (its material is separate from the cache's). */
  proc?: CompiledStacks;
  imgCache: ImageNodeCache;
  /** Color-channel image fingerprint — the mirror mix bakes the base color node. */
  imgColorKey: string;
}

interface Entry {
  mat: NodeMaterial;
  type: MaterialType;
  /** Compiled procedural stacks (E3), when the DTO has any. */
  proc?: CompiledStacks;
  /** Identity-stable projected-image nodes (see {@link ImageNodeCache}). */
  imgCache: ImageNodeCache;
}

export class MaterialSync {
  private cache = new Map<Uuid, Entry>();
  /** Per-NODE planar-reflection material variants (each mesh mirrors its own plane). */
  private planar = new Map<Uuid, PlanarEntry>();
  private readonly doc: Document;
  private readonly textures: TextureCache;
  private readonly onDirty: () => void;
  private warm: WarmFn | null = null;
  /** Structural swaps in flight, keyed by material id (newest wins). */
  private swapToken = new Map<Uuid, number>();
  /** Fallback for unassigned meshes / dangling ids (the viewport default look). */
  readonly defaultMat: Material;

  constructor(doc: Document, defaultMat: Material, onDirty: () => void = () => {}) {
    this.doc = doc;
    this.defaultMat = defaultMat;
    this.onDirty = onDirty;
    // a texture that decodes after the frame re-binds every channel + re-renders
    this.textures = new TextureCache(() => {
      this.reapplyTextures();
      onDirty();
    });
  }

  /**
   * Supply a pipeline-warming function (the render layer owns the renderer, so
   * it injects this). With it, a structural procedural edit compiles the new
   * shader OFF the critical path and swaps only once it's ready — the old
   * material keeps drawing meanwhile, so the edit lands without a frame hitch.
   * Without it, the swap is immediate and the recompile hitches the next frame.
   */
  setWarm(fn: WarmFn | null): void {
    this.warm = fn;
  }

  /** Material for a node's assignment id (builds lazily; default when absent). */
  resolve(id: Uuid | undefined): Material {
    if (!id) return this.defaultMat;
    const dto = this.doc.materials.get(id);
    if (!dto) return this.defaultMat;
    let entry = this.cache.get(id);
    if (!entry || entry.type !== dto.type) {
      entry = { mat: buildMaterial(dto), type: dto.type, imgCache: new Map() };
      this.cache.set(id, entry);
      this.compileProcedural(entry, dto);
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
    // the procedural structure key joins type/id here: a structural stack edit
    // changes neither of those, so without it this variant would go stale. The
    // color-image key does the same for a projected color map — the mirror mix
    // bakes the base color node, so a new image/projection needs a rebuild.
    const procKey = structureKey(dto?.procedural);
    // decode state is part of the key: a projected color image that finishes
    // decoding after this variant built must still trigger the rebuild
    const mapReady = dto?.textures?.map ? !!this.textures.get(dto.textures.map, "srgb") : false;
    const imgColorKey = `${dto?.textures?.map ?? ""}:${dto?.textureProjections?.map ?? "uv"}:${mapReady ? 1 : 0}:${JSON.stringify(dto?.textureProjectionTransforms?.map ?? 0)}`;
    if (
      !e ||
      e.type !== type ||
      e.matId !== (dto ? matId : undefined) ||
      (e.proc?.key ?? "") !== procKey ||
      e.imgColorKey !== imgColorKey
    ) {
      if (e) this.disposePlanar(e);
      const refl = reflector({ resolutionScale: cfg.resolution, generateMipmaps: true });
      refl.target.name = "planar-reflector-target";
      const strength = uniform(MathUtils.clamp(cfg.strength, 0, 1));
      const mat = dto ? buildMaterial(dto) : (this.defaultMat.clone() as NodeMaterial);
      // a procedural stack (or projected image) drives this material's other
      // channels, and its color output becomes the BASE the mirror composites
      // over — they must compose, since both want `colorNode`
      const proc = dto ? compileStacks(dto) : undefined;
      const imgCache: ImageNodeCache = new Map();
      if (dto) this.bindChannels(mat, dto, proc, imgCache);
      const base = proc?.nodes.color ?? imgCache.get("color")?.node ?? materialColor;
      // mirror color over the base color; mipmapped bicubic sampling blurs the
      // reflection by the material's roughness (frosted mirrors for free)
      mat.colorNode = mix(base, textureBicubic(refl, materialRoughness).rgb, strength);
      e = {
        mat,
        matId: dto ? matId : undefined,
        type,
        refl,
        strength,
        axis: cfg.axis,
        proc,
        imgCache,
        imgColorKey,
      };
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
    e.proc?.dispose();
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
          // keepColor: the mirror mix owns colorNode; a color-image change
          // rebuilds the variant via the imgColorKey compare in resolvePlanar
          this.bindChannels(e.mat, dto, e.proc, e.imgCache, true);
          // param-only procedural edits poke this variant's uniforms too; a
          // structural one is left to the key compares in resolvePlanar
          const proc = dto.procedural;
          if (e.proc && proc && e.proc.applies(proc)) e.proc.update(proc);
        }
      }
    }
    if (!dto || !entry) return; // uncached → resolve() builds fresh with current params
    if (entry.type !== dto.type) {
      const rebuilt: Entry = { mat: buildMaterial(dto), type: dto.type, imgCache: new Map() };
      this.cache.set(id, rebuilt);
      this.compileProcedural(rebuilt, dto);
      return;
    }
    applyMaterialParams(entry.mat, dto);

    // Procedural stacks are the third branch (E3): a param-only edit pokes live
    // uniforms on the SAME graph and must not recompile; only a structural edit
    // rebuilds, and that goes through the warm-then-swap path below.
    const proc = dto.procedural;
    if (entry.proc && proc && entry.proc.applies(proc)) {
      entry.proc.update(proc);
      this.bindChannels(entry.mat, dto, entry.proc, entry.imgCache);
      return;
    }
    if (hasStacks(dto) && entry.proc && this.warm) {
      void this.swapProcedural(id, dto);
      return;
    }
    this.compileProcedural(entry, dto);
  }

  /**
   * Compile `dto`'s stacks onto `entry.mat` in place. Synchronous: the shader
   * recompiles on the next render (a hitch). Used for first build, and as the
   * fallback when no warm function is installed.
   */
  private compileProcedural(entry: Entry, dto: MaterialDTO): void {
    entry.proc?.dispose();
    entry.proc = compileStacks(dto);
    this.bindChannels(entry.mat, dto, entry.proc, entry.imgCache);
  }

  /**
   * Structural procedural edit: build the replacement material, warm its
   * pipeline, and only then swap it into the cache. The outgoing material keeps
   * rendering until the new shader is ready, so the edit is hitch-free.
   *
   * `swapToken` guards the interleaving — a rapid second edit supersedes the
   * first, and a stale warm that finishes late is discarded rather than
   * clobbering the newer material.
   */
  private async swapProcedural(id: Uuid, dto: MaterialDTO): Promise<void> {
    const token = (this.swapToken.get(id) ?? 0) + 1;
    this.swapToken.set(id, token);

    const next: Entry = { mat: buildMaterial(dto), type: dto.type, imgCache: new Map() };
    next.proc = compileStacks(dto);
    this.bindChannels(next.mat, dto, next.proc, next.imgCache);

    try {
      await this.warm?.(next.mat, id);
    } catch {
      // a warm failure is not fatal — swap anyway and eat the hitch
    }
    if (this.swapToken.get(id) !== token) {
      next.proc?.dispose(); // superseded mid-flight
      next.mat.dispose();
      return;
    }
    const prev = this.cache.get(id);
    this.cache.set(id, next);
    prev?.proc?.dispose();
    this.onDirty();
  }

  /** Material deleted — drop it; meshes fall back to the default via resolve(). */
  onRemoved(id: Uuid): void {
    // an in-flight swap for this id must not resurrect it
    this.swapToken.delete(id);
    this.cache.get(id)?.proc?.dispose();
    this.cache.delete(id);
  }

  clear(): void {
    for (const e of this.cache.values()) e.proc?.dispose();
    this.cache.clear();
    this.swapToken.clear();
    for (const e of this.planar.values()) this.disposePlanar(e);
    this.planar.clear();
    this.textures.dispose();
  }

  /**
   * Bind every channel of `mat` from `dto`: UV images ride the plain three map
   * properties (the fast path — unchanged behavior), projected images and noise
   * stacks bind TSL nodes into the channel slots via {@link assignChannelNodes}.
   * Adding/removing either changes the compiled shader (`needsUpdate`). A
   * channel whose texture is still decoding binds nothing now and is re-bound
   * when the cache fires ready (see the constructor).
   */
  private bindChannels(
    mat: NodeMaterial,
    dto: MaterialDTO,
    proc: CompiledStacks | undefined,
    imgCache: ImageNodeCache,
    keepColor = false,
  ): void {
    const m = mat as unknown as Record<string, unknown>;
    const specs: Partial<Record<ProceduralChannel, ImageSpec>> = {};
    // Channels muted by the eye toggle: keep the data but bind nothing (fall back
    // to the scalar) — for both the plain map prop and the procedural/image node.
    const disabled = new Set<ProceduralChannel>();
    let changed = false;
    for (const { channel, applies, colorSpace } of TEXTURE_CHANNELS) {
      if (!(channel in mat)) continue;
      const off = dto.disabledChannels?.[channel] === true;
      if (off) disabled.add(TEXTURE_TO_PROCEDURAL[channel]);
      const id = off || !applies.has(dto.type) ? undefined : dto.textures?.[channel];
      // normal maps are tangent-space — they only make sense in a UV frame
      const projection =
        channel === "normalMap" ? "uv" : (dto.textureProjections?.[channel] ?? "uv");
      const tex = id ? (this.textures.get(id, colorSpace) ?? null) : null;
      const projected = tex !== null && projection !== "uv";
      if (projected)
        specs[TEXTURE_TO_PROCEDURAL[channel]] = {
          tex,
          projection,
          transform: dto.textureProjectionTransforms?.[channel],
        };
      const prop = projected ? null : tex;
      if (m[channel] !== prop) {
        m[channel] = prop;
        changed = true;
      }
    }
    if (changed) mat.needsUpdate = true;
    assignChannelNodes(mat, proc, specs, imgCache, keepColor, disabled);
  }

  private reapplyTextures(): void {
    for (const [id, entry] of this.cache) {
      const dto = this.doc.materials.get(id);
      if (dto) this.bindChannels(entry.mat, dto, entry.proc, entry.imgCache);
    }
    // planar variants re-bind their non-color channels too; a projected COLOR
    // image that finished decoding rebuilds via imgColorKey on the next resolve
    for (const e of this.planar.values()) {
      const dto = e.matId ? this.doc.materials.get(e.matId) : undefined;
      if (dto) this.bindChannels(e.mat, dto, e.proc, e.imgCache, true);
    }
  }
}
