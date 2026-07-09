import { describe, expect, it } from "vite-plus/test";
import type { PrimitiveDescriptor, PrimitiveType } from "@/types/geometry/primitives";
import { defaultPrimitive, primitiveDefaults } from "@/types/geometry/primitives";
import { buildPrimitive } from "@/geometry/primitives";
import { HEMesh } from "./HEMesh";
import { validateMesh } from "./validate";

const ALL_TYPES = Object.keys(primitiveDefaults) as PrimitiveType[];

/** closed genus-0 primitives → Euler characteristic 2, no boundary */
const CLOSED: PrimitiveType[] = [
  "cube",
  "sphere",
  "icosphere",
  "cylinder",
  "cone",
  "capsule",
  "pyramid",
];

/** convex closed primitives → every face normal must point away from origin */
const CONVEX: PrimitiveType[] = [
  "cube",
  "sphere",
  "icosphere",
  "cylinder",
  "cone",
  "capsule",
  "pyramid",
];

describe("HEMesh invariants across the primitive catalog", () => {
  for (const type of ALL_TYPES) {
    it(`${type}: builds a valid half-edge mesh`, () => {
      const mesh = buildPrimitive(defaultPrimitive(type));
      const v = validateMesh(mesh);
      expect(v.errors).toEqual([]);
      expect(mesh.vCount).toBeGreaterThan(0);
      expect(mesh.fCount).toBeGreaterThan(0);
    });
  }

  for (const type of CLOSED) {
    it(`${type}: closed genus-0 (Euler 2, no boundary)`, () => {
      const mesh = buildPrimitive(defaultPrimitive(type));
      const v = validateMesh(mesh);
      expect(v.boundaryEdges).toBe(0);
      expect(v.eulerCharacteristic).toBe(2);
    });
  }

  it("torus: closed genus-1 (Euler 0)", () => {
    const mesh = buildPrimitive(defaultPrimitive("torus"));
    const v = validateMesh(mesh);
    expect(v.boundaryEdges).toBe(0);
    expect(v.eulerCharacteristic).toBe(0);
  });

  it("plane and disc: disks (Euler 1, boundary present)", () => {
    for (const type of ["plane", "disc"] as const) {
      const v = validateMesh(buildPrimitive(defaultPrimitive(type)));
      expect(v.eulerCharacteristic).toBe(1);
      expect(v.boundaryEdges).toBeGreaterThan(0);
    }
  });

  for (const type of CONVEX) {
    it(`${type}: outward winding (face normals point away from centroid)`, () => {
      const mesh = buildPrimitive(defaultPrimitive(type));
      const n: [number, number, number] = [0, 0, 0];
      const p: [number, number, number] = [0, 0, 0];
      for (let f = 0; f < mesh.fCount; f++) {
        mesh.faceNormal(f, n);
        // face centroid
        const verts = mesh.faceVertices(f);
        let cx = 0;
        let cy = 0;
        let cz = 0;
        for (const v of verts) {
          mesh.getPosition(v, p);
          cx += p[0];
          cy += p[1];
          cz += p[2];
        }
        cx /= verts.length;
        cy /= verts.length;
        cz /= verts.length;
        const dot = n[0] * cx + n[1] * cy + n[2] * cz;
        expect(dot).toBeGreaterThan(0);
      }
    });
  }

  it("parameter variations stay valid (segment sweeps)", () => {
    const sweeps: PrimitiveDescriptor[] = [
      { type: "sphere", params: { radius: 2, segments: 3, rings: 3 } },
      { type: "sphere", params: { radius: 0.1, segments: 64, rings: 32 } },
      {
        type: "cylinder",
        params: { radiusTop: 0.2, radiusBottom: 1, height: 3, segments: 3, capped: true },
      },
      {
        type: "cylinder",
        params: { radiusTop: 1, radiusBottom: 1, height: 1, segments: 48, capped: false },
      },
      { type: "torus", params: { radius: 2, tube: 0.1, segments: 3, tubeSegments: 3 } },
      { type: "plane", params: { width: 1, depth: 1, segmentsX: 1, segmentsZ: 1 } },
      { type: "icosphere", params: { radius: 1, subdivisions: 0 } },
      { type: "icosphere", params: { radius: 1, subdivisions: 3 } },
      { type: "capsule", params: { radius: 1, height: 0.2, segments: 3, capRings: 2 } },
    ];
    for (const desc of sweeps) {
      const v = validateMesh(buildPrimitive(desc));
      expect(v.errors, `${desc.type} ${JSON.stringify(desc.params)}`).toEqual([]);
    }
  });

  it("rejects non-manifold input (duplicate directed edge)", () => {
    expect(() =>
      HEMesh.fromPolygons({
        positions: [0, 0, 0, 1, 0, 0, 0, 1, 0],
        faces: [
          [0, 1, 2],
          [0, 1, 2], // same winding → duplicate directed edges
        ],
      }),
    ).toThrow(/non-manifold/);
  });

  it("snapshot/restore round-trips exactly and bumps topologyVersion", () => {
    const mesh = buildPrimitive(defaultPrimitive("cube"));
    const snap = mesh.snapshot();
    const tvBefore = mesh.topologyVersion;
    mesh.setPosition(0, 9, 9, 9);
    mesh.restore(snap);
    expect(mesh.vPos[0]).toBe(snap.vPos[0]);
    expect(validateMesh(mesh).ok).toBe(true);
    expect(mesh.topologyVersion).toBe(tvBefore + 1);
  });
});
