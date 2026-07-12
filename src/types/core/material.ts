import type { Uuid } from "./ids";

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
}

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
