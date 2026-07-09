/**
 * Parametric primitive descriptors. Stored on mesh nodes at
 * `node.data.primitive`; live-editable until "make editable" (chunk D4)
 * collapses the node to a base HEMesh.
 */

export interface CubeParams {
  width: number;
  height: number;
  depth: number;
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
}
export interface SphereParams {
  radius: number;
  segments: number; // around Y
  rings: number; // pole to pole
}
export interface IcosphereParams {
  radius: number;
  subdivisions: number; // 0..4
}
export interface CylinderParams {
  radiusTop: number;
  radiusBottom: number;
  height: number;
  segments: number;
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
  cube: { width: 2, height: 2, depth: 2 },
  plane: { width: 4, depth: 4, segmentsX: 4, segmentsZ: 4 },
  disc: { radius: 1, segments: 32 },
  sphere: { radius: 1, segments: 32, rings: 16 },
  icosphere: { radius: 1, subdivisions: 2 },
  cylinder: { radiusTop: 1, radiusBottom: 1, height: 2, segments: 32, capped: true },
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
