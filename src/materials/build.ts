import { Color, DoubleSide } from "three";
import {
  MeshBasicNodeMaterial,
  MeshLambertNodeMaterial,
  MeshMatcapNodeMaterial,
  MeshNormalNodeMaterial,
  MeshPhongNodeMaterial,
  MeshPhysicalNodeMaterial,
  MeshStandardNodeMaterial,
  MeshToonNodeMaterial,
  type NodeMaterial,
} from "three/webgpu";
import type { MaterialDTO, MaterialType } from "@/types/core";

/**
 * MaterialDTO → three WebGPU node material. This is the only place that names
 * concrete three material classes (like the tsl barrel for TSL). One built
 * material is SHARED across every mesh that references the DTO; param edits
 * apply in place (they propagate to all meshes — verified), a TYPE change
 * rebuilds a fresh material (see the render layer's material cache).
 */

function construct(type: MaterialType): NodeMaterial {
  switch (type) {
    case "physical":
      return new MeshPhysicalNodeMaterial();
    case "standard":
      return new MeshStandardNodeMaterial();
    case "basic":
      return new MeshBasicNodeMaterial();
    case "lambert":
      return new MeshLambertNodeMaterial();
    case "phong":
      return new MeshPhongNodeMaterial();
    case "toon":
      return new MeshToonNodeMaterial();
    case "matcap":
      return new MeshMatcapNodeMaterial();
    case "normal":
      return new MeshNormalNodeMaterial();
  }
}

/** Superset of the scalar/color props across the node-material families. */
interface MatProps {
  color?: Color;
  roughness?: number;
  metalness?: number;
  emissive?: Color;
  emissiveIntensity?: number;
  opacity: number;
  transparent: boolean;
}

/** Apply DTO params to an existing material IN PLACE (only fields the type has). */
export function applyMaterialParams(mat: NodeMaterial, dto: MaterialDTO): void {
  const m = mat as unknown as MatProps;
  if (m.color) m.color.set(dto.color);
  if ("roughness" in mat) m.roughness = dto.roughness;
  if ("metalness" in mat) m.metalness = dto.metalness;
  if (m.emissive) m.emissive.set(dto.emissive);
  if ("emissiveIntensity" in mat) m.emissiveIntensity = dto.emissiveIntensity;
  m.opacity = dto.opacity;
  m.transparent = dto.transparent;
}

/** Build a fresh, double-sided node material for a DTO with its params applied. */
export function buildMaterial(dto: MaterialDTO): NodeMaterial {
  const mat = construct(dto.type);
  mat.side = DoubleSide;
  applyMaterialParams(mat, dto);
  return mat;
}
