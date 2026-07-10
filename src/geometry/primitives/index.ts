import type { PolygonMeshData } from "@/types/geometry/mesh";
import type { PrimitiveDescriptor } from "@/types/geometry/primitives";
import { HEMesh } from "@/geometry/kernel/HEMesh";
import { buildCube, buildDisc, buildPlane, buildPyramid } from "./basic";
import { buildIcosphere } from "./ico";
import { buildCapsule, buildCone, buildCylinder, buildSphere, buildTorus } from "./lathe";

export function buildPrimitiveData(desc: PrimitiveDescriptor): PolygonMeshData {
  switch (desc.type) {
    case "cube":
      return buildCube(desc.params);
    case "plane":
      return buildPlane(desc.params);
    case "disc":
      return buildDisc(desc.params);
    case "pyramid":
      return buildPyramid(desc.params);
    case "sphere":
      // Icosa mode: the combined sphere delegates to the icosphere builder
      if (desc.params.icosa) {
        return buildIcosphere({
          radius: desc.params.radius,
          subdivisions: desc.params.subdivisions ?? 2,
        });
      }
      return buildSphere(desc.params);
    case "cylinder":
      return buildCylinder(desc.params);
    case "cone":
      return buildCone(desc.params);
    case "capsule":
      return buildCapsule(desc.params);
    case "torus":
      return buildTorus(desc.params);
    case "icosphere":
      return buildIcosphere(desc.params);
  }
}

export function buildPrimitive(desc: PrimitiveDescriptor): HEMesh {
  return HEMesh.fromPolygons(buildPrimitiveData(desc));
}
