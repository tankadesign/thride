/**
 * Parametric primitive descriptors. Stored on mesh nodes at
 * `node.data.primitive`; live-editable until "make editable" (chunk D4)
 * collapses the node to a base HEMesh.
 */

export interface CubeParams {
  width: number;
  height: number;
  depth: number;
  /** Subdivisions along each axis. Optional: cubes saved before these existed
   * load as 1 segment (a plain box). */
  segmentsW?: number;
  segmentsH?: number;
  segmentsD?: number;
}
export interface PlaneParams {
  width: number;
  depth: number;
  segmentsX: number;
  segmentsZ: number;
}
export interface DiscParams {
  radius: number;
  segments: number;
  /** Concentric subdivisions from the center outward. Optional: discs saved
   * before the param existed load as 1 ring. */
  rings?: number;
}
export interface SphereParams {
  radius: number;
  /** Icosa mode: subdivided icosahedron (standard-mode params hidden). */
  icosa?: boolean;
  segments: number; // standard: around Y ("Horizontal Segments")
  rings: number; // standard: pole to pole ("Vertical Segments")
  subdivisions?: number; // icosa mode, 0..5
  /** Standard mode: top half only (open at the equator). */
  hemisphere?: boolean;
  /** Hemisphere only: close the equator hole with a center-point fan. */
  filled?: boolean;
}
/** Legacy standalone type — new content uses sphere's icosa mode. */
export interface IcosphereParams {
  radius: number;
  subdivisions: number; // 0..4
}
export interface CylinderParams {
  radiusTop: number;
  radiusBottom: number;
  height: number;
  segments: number; // radial ("Rot. Segments")
  /** Subdivisions along the height. Optional: cylinders saved before it existed
   * load as 1 segment. */
  heightSegments?: number;
  capped: boolean;
}
export interface ConeParams {
  radius: number;
  height: number;
  segments: number;
  capped: boolean;
}
export interface CapsuleParams {
  radius: number;
  height: number; // cylindrical mid-section
  segments: number;
  capRings: number;
}
export interface TorusParams {
  radius: number; // ring
  tube: number;
  segments: number; // around ring
  tubeSegments: number;
}
export interface PyramidParams {
  width: number;
  height: number;
  depth: number;
}

export type PrimitiveDescriptor =
  | { type: "cube"; params: CubeParams }
  | { type: "plane"; params: PlaneParams }
  | { type: "disc"; params: DiscParams }
  | { type: "sphere"; params: SphereParams }
  | { type: "icosphere"; params: IcosphereParams }
  | { type: "cylinder"; params: CylinderParams }
  | { type: "cone"; params: ConeParams }
  | { type: "capsule"; params: CapsuleParams }
  | { type: "torus"; params: TorusParams }
  | { type: "pyramid"; params: PyramidParams };

export type PrimitiveType = PrimitiveDescriptor["type"];

export const primitiveDefaults: {
  [K in PrimitiveType]: Extract<PrimitiveDescriptor, { type: K }>["params"];
} = {
  cube: { width: 2, height: 2, depth: 2, segmentsW: 1, segmentsH: 1, segmentsD: 1 },
  plane: { width: 4, depth: 4, segmentsX: 4, segmentsZ: 4 },
  disc: { radius: 1, segments: 32, rings: 1 },
  sphere: {
    radius: 1,
    icosa: false,
    segments: 32,
    rings: 16,
    subdivisions: 2,
    hemisphere: false,
    filled: false,
  },
  icosphere: { radius: 1, subdivisions: 2 },
  cylinder: {
    radiusTop: 1,
    radiusBottom: 1,
    height: 2,
    segments: 32,
    heightSegments: 1,
    capped: true,
  },
  cone: { radius: 1, height: 2, segments: 32, capped: true },
  capsule: { radius: 0.5, height: 1, segments: 24, capRings: 6 },
  torus: { radius: 1, tube: 0.35, segments: 32, tubeSegments: 16 },
  pyramid: { width: 2, height: 2, depth: 2 },
};

export const primitiveLabels: Record<PrimitiveType, string> = {
  cube: "Cube",
  plane: "Plane",
  disc: "Disc",
  sphere: "Sphere",
  icosphere: "Icosphere",
  cylinder: "Cylinder",
  cone: "Cone",
  capsule: "Capsule",
  torus: "Torus",
  pyramid: "Pyramid",
};

export function defaultPrimitive(type: PrimitiveType): PrimitiveDescriptor {
  return { type, params: structuredClone(primitiveDefaults[type]) } as PrimitiveDescriptor;
}

export interface ParamMeta {
  int?: boolean;
  min?: number;
  max?: number;
  /** Display label when the raw param key isn't right for the panel. */
  label?: string;
}

/** Editing metadata per parameter name (int-stepped inputs, ranges). */
export const primitiveParamMeta: Record<string, ParamMeta> = {
  segments: { int: true, min: 3, max: 1000 },
  tubeSegments: { int: true, min: 3, max: 1000 },
  rings: { int: true, min: 3, max: 1000 },
  segmentsX: { int: true, min: 1, max: 1000 },
  segmentsZ: { int: true, min: 1, max: 1000 },
  segmentsW: { int: true, min: 1, max: 1000, label: "Segments W" },
  segmentsH: { int: true, min: 1, max: 1000, label: "Segments H" },
  segmentsD: { int: true, min: 1, max: 1000, label: "Segments D" },
  heightSegments: { int: true, min: 1, max: 1000, label: "Height Segments" },
  subdivisions: { int: true, min: 0, max: 5 },
  capRings: { int: true, min: 2, max: 128 },
};

/** Same param name, different rules per primitive (disc rings start at 1). */
const perTypeParamMeta: Partial<Record<PrimitiveType, Record<string, ParamMeta>>> = {
  disc: { rings: { int: true, min: 1, max: 500 } },
  // cylinder's radial "segments" is around the axis — label it so it reads
  // distinctly from the new height subdivisions
  cylinder: { segments: { int: true, min: 3, max: 1000, label: "Rot. Segments" } },
  sphere: {
    segments: { int: true, min: 3, max: 1000, label: "Horizontal Segments" },
    rings: { int: true, min: 3, max: 1000, label: "Vertical Segments" },
    subdivisions: { int: true, min: 0, max: 5, label: "Subdivisions" },
    icosa: { label: "Icosa" },
    hemisphere: { label: "Hemisphere" },
    filled: { label: "Filled" },
  },
};

export function paramMeta(key: string, type?: PrimitiveType): ParamMeta {
  return (
    (type ? perTypeParamMeta[type]?.[key] : undefined) ?? primitiveParamMeta[key] ?? { min: 0.001 }
  );
}

/**
 * Ordered, mode-aware param keys for the editor panel. Defaults are merged
 * under stored params first, so params added after a node was saved still
 * appear. Sphere hides standard-mode params in Icosa mode and reveals
 * Filled only for hemispheres.
 */
export function visibleParams(desc: PrimitiveDescriptor): string[] {
  if (desc.type === "sphere") {
    if (desc.params.icosa) return ["radius", "icosa", "subdivisions"];
    const keys = ["radius", "icosa", "segments", "rings", "hemisphere"];
    if (desc.params.hemisphere) keys.push("filled");
    return keys;
  }
  return Object.keys({ ...primitiveDefaults[desc.type], ...desc.params });
}
