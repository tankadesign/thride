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
import { PHYSICAL_DEFAULTS as PD } from "@/types/core";

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
  // MeshPhysical extras
  clearcoat?: number;
  clearcoatRoughness?: number;
  transmission?: number;
  ior?: number;
  thickness?: number;
  sheen?: number;
  sheenRoughness?: number;
  sheenColor?: Color;
  iridescence?: number;
  iridescenceIOR?: number;
  specularIntensity?: number;
  specularColor?: Color;
}

/** Apply DTO params to an existing material IN PLACE (only fields the type has). */
export function applyMaterialParams(mat: NodeMaterial, dto: MaterialDTO): void {
  const m = mat as unknown as MatProps;
  if (m.color) m.color.set(dto.color);
  if ("roughness" in mat) m.roughness = dto.roughness;
  if ("metalness" in mat) m.metalness = dto.metalness;
  if (m.emissive) m.emissive.set(dto.emissive);
  if ("emissiveIntensity" in mat) m.emissiveIntensity = dto.emissiveIntensity;
  // MeshPhysical extras — absent DTO fields fall back to three's defaults
  if ("clearcoat" in mat) {
    m.clearcoat = dto.clearcoat ?? PD.clearcoat;
    m.clearcoatRoughness = dto.clearcoatRoughness ?? PD.clearcoatRoughness;
  }
  if ("transmission" in mat) {
    m.transmission = dto.transmission ?? PD.transmission;
    m.ior = dto.ior ?? PD.ior;
    m.thickness = dto.thickness ?? PD.thickness;
  }
  if ("sheen" in mat) {
    m.sheen = dto.sheen ?? PD.sheen;
    m.sheenRoughness = dto.sheenRoughness ?? PD.sheenRoughness;
    if (m.sheenColor) m.sheenColor.set(dto.sheenColor ?? PD.sheenColor);
  }
  if ("iridescence" in mat) {
    m.iridescence = dto.iridescence ?? PD.iridescence;
    m.iridescenceIOR = dto.iridescenceIOR ?? PD.iridescenceIOR;
  }
  if ("specularIntensity" in mat) {
    m.specularIntensity = dto.specularIntensity ?? PD.specularIntensity;
    if (m.specularColor) m.specularColor.set(dto.specularColor ?? PD.specularColor);
  }
  m.opacity = dto.opacity;
  // opacity < 1 needs transparency to show; `transparent`/`depthWrite` are
  // pipeline blend-state (NOT uniforms), so an in-place change only takes
  // effect after needsUpdate. depthWrite off lets transparents composite through.
  const wantTransparent = dto.transparent || dto.opacity < 1;
  if (mat.transparent !== wantTransparent) {
    mat.transparent = wantTransparent;
    mat.depthWrite = !wantTransparent;
    mat.needsUpdate = true;
  }
}

/** Build a fresh, double-sided node material for a DTO with its params applied. */
export function buildMaterial(dto: MaterialDTO): NodeMaterial {
  const mat = construct(dto.type);
  mat.side = DoubleSide;
  applyMaterialParams(mat, dto);
  return mat;
}
