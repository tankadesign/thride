import type { Uuid } from "./ids";
import type {
  ProceduralChannel,
  ProceduralMaterialDoc,
  Projection,
  ProjectionTransform,
} from "./procedural";

/**
 * Built-in three.js material families the manager can create. Each maps to a
 * WebGPU node-material class in `materials/` (MeshPhysicalNodeMaterial, …).
 * `physical` is the default (full PBR: metalness/roughness + clearcoat later).
 */
export type MaterialType =
  | "physical"
  | "standard"
  | "basic"
  | "lambert"
  | "phong"
  | "toon"
  | "matcap"
  | "normal";

export const MATERIAL_TYPES: { type: MaterialType; label: string }[] = [
  { type: "physical", label: "Physical" },
  { type: "standard", label: "Standard" },
  { type: "basic", label: "Basic" },
  { type: "lambert", label: "Lambert" },
  { type: "phong", label: "Phong" },
  { type: "toon", label: "Toon" },
  { type: "matcap", label: "Matcap" },
  { type: "normal", label: "Normal" },
];

/** True where the field is meaningful (drives which params the panel shows). */
export const HAS_PBR = new Set<MaterialType>(["physical", "standard"]);
export const HAS_COLOR = new Set<MaterialType>([
  "physical",
  "standard",
  "basic",
  "lambert",
  "phong",
  "toon",
]);
export const HAS_EMISSIVE = new Set<MaterialType>(["physical", "standard", "lambert", "phong"]);
/** Clearcoat / transmission / sheen / iridescence / specular are MeshPhysical-only. */
export const HAS_PHYSICAL = new Set<MaterialType>(["physical"]);

/**
 * Image-map channels a material can bind. Each maps to a three material slot
 * (`map`, `roughnessMap`, …). A material references a texture asset by id per
 * channel (`MaterialDTO.textures`); the bytes live in the texture-asset registry
 * and persist alongside kernel meshes in the project record. Procedural layer
 * stacks (E3) build on top of these raw image channels.
 */
export type TextureChannel = "map" | "roughnessMap" | "metalnessMap" | "normalMap" | "emissiveMap";

export const TEXTURE_CHANNELS: {
  channel: TextureChannel;
  label: string;
  /** Which material types expose this channel (gates the editor slots). */
  applies: Set<MaterialType>;
  /** sRGB (color data) vs linear (data maps) — set on the three texture. */
  colorSpace: "srgb" | "linear";
}[] = [
  { channel: "map", label: "Color", applies: HAS_COLOR, colorSpace: "srgb" },
  { channel: "roughnessMap", label: "Roughness", applies: HAS_PBR, colorSpace: "linear" },
  { channel: "metalnessMap", label: "Metalness", applies: HAS_PBR, colorSpace: "linear" },
  {
    channel: "normalMap",
    label: "Normal",
    applies: new Set<MaterialType>(["physical", "standard", "lambert", "phong", "toon"]),
    colorSpace: "linear",
  },
  { channel: "emissiveMap", label: "Emissive", applies: HAS_EMISSIVE, colorSpace: "srgb" },
];

/**
 * Which procedural channel occupies the same slot as each image-map channel.
 * A channel holds an image OR a noise, never both — the material editor's map
 * slot enforces the exclusivity through this correspondence.
 */
export const TEXTURE_TO_PROCEDURAL: Record<TextureChannel, ProceduralChannel> = {
  map: "color",
  roughnessMap: "roughness",
  metalnessMap: "metalness",
  normalMap: "normal",
  emissiveMap: "emissive",
};

/**
 * A bitmap texture asset in the project library. `bytes` is the raw encoded
 * image file (PNG/JPEG/…) — stored natively by IndexedDB structured clone (no
 * base64), decoded to a GPU texture lazily by the render layer. Referenced by
 * id from `MaterialDTO.textures`.
 */
export interface TextureAssetDTO {
  id: Uuid;
  name: string;
  /** MIME of `bytes`, e.g. "image/png". */
  mime: string;
  bytes: Uint8Array;
}

/**
 * A named material in the project library, assignable to any mesh by id
 * (`node.data.material`). Pure serializable data — the render layer compiles it
 * into a three node material and shares that across every mesh that references
 * it. Procedural layer stacks (E3) extend this later; kept lean for now.
 */
export interface MaterialDTO {
  id: Uuid;
  name: string;
  type: MaterialType;
  /** Base color, hex. */
  color: string;
  /** PBR (physical/standard). */
  roughness: number;
  metalness: number;
  /** Emissive color (hex) + strength. */
  emissive: string;
  emissiveIntensity: number;
  /** 0..1; `transparent` must be on for opacity < 1 to show. */
  opacity: number;
  transparent: boolean;

  // ---- MeshPhysicalMaterial extras (optional; absent → the default below) ----
  /** Clearcoat lacquer layer. */
  clearcoat?: number;
  clearcoatRoughness?: number;
  /** Glass-like light transmission (needs opacity/transparent handling). */
  transmission?: number;
  ior?: number;
  thickness?: number;
  /** Cloth-like retroreflective sheen. */
  sheen?: number;
  sheenRoughness?: number;
  sheenColor?: string;
  /** Thin-film iridescence (soap bubble / oil). */
  iridescence?: number;
  iridescenceIOR?: number;
  /** Specular reflection tint/strength (dielectric). */
  specularIntensity?: number;
  specularColor?: string;

  /** Image-map channels → texture-asset id. Absent/empty = no maps. */
  textures?: Partial<Record<TextureChannel, Uuid>>;

  /**
   * How each image channel derives its sample coordinate. Absent = `uv` (the
   * plain three map-property path). Non-uv channels sample through the same
   * projections as noises. `normalMap` is always uv — tangent-space normal
   * maps need a UV frame.
   */
  textureProjections?: Partial<Record<TextureChannel, Projection>>;

  /**
   * Per-image-channel projection placement (offset/rotation/scale in object
   * space), mirroring a procedural layer's transform. Absent = identity; only
   * meaningful for non-`uv` projections. Editing it currently rebuilds the
   * channel's projected node (const-node placement) — live uniform-backed
   * editing + the viewport texture-mode gizmo are M5.
   */
  textureProjectionTransforms?: Partial<Record<TextureChannel, ProjectionTransform>>;

  /**
   * Procedural layer stacks (E3), compiled to TSL per channel. Absent = a plain
   * scalar/bitmap material. A channel with a stack overrides the scalar field
   * above it (a `color` stack drives `colorNode`, not `color`).
   */
  procedural?: ProceduralMaterialDoc;
}

/** Defaults for the optional physical fields — shared by the editor + builder. */
export const PHYSICAL_DEFAULTS = {
  clearcoat: 0,
  clearcoatRoughness: 0,
  transmission: 0,
  ior: 1.5,
  thickness: 0,
  sheen: 0,
  sheenRoughness: 1,
  sheenColor: "#ffffff",
  iridescence: 0,
  iridescenceIOR: 1.3,
  specularIntensity: 1,
  specularColor: "#ffffff",
} as const;

/** Default params for a new material of `type` (physical = full PBR default). */
export function defaultMaterialData(
  type: MaterialType = "physical",
): Omit<MaterialDTO, "id" | "name"> {
  return {
    type,
    color: "#cccccc",
    roughness: 0.55,
    metalness: 0.0,
    emissive: "#000000",
    emissiveIntensity: 1,
    opacity: 1,
    transparent: false,
  };
}
