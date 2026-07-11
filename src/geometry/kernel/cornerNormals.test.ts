import { describe, expect, it } from "vite-plus/test";
import type { PrimitiveType } from "@/types/geometry/primitives";
import { primitiveDefaults } from "@/types/geometry/primitives";
import type { SplineData } from "@/types/geometry/spline";
import { buildPrimitive } from "@/geometry/primitives";
import { buildSplineExtrude } from "@/generators/splineExtrude";
import { trisToHEMesh } from "@/geometry/boolean/booleanEngine";
import type { HEMesh } from "./HEMesh";

/** Per-face list of corner normals, walking each face's half-edge loop. */
function faceCornerNormals(
  m: HEMesh,
): { faceDegree: number; normals: [number, number, number][] }[] {
  const cn = m.computeCornerNormals();
  const out: { faceDegree: number; normals: [number, number, number][] }[] = [];
  for (let f = 0; f < m.fCount; f++) {
    const normals: [number, number, number][] = [];
    const start = m.fHE[f]!;
    let h = start;
    do {
      normals.push([cn[h * 3]!, cn[h * 3 + 1]!, cn[h * 3 + 2]!]);
      h = m.heNext[h]!;
    } while (h !== start);
    out.push({ faceDegree: normals.length, normals });
  }
  return out;
}

const len = (v: [number, number, number]) => Math.hypot(v[0], v[1], v[2]);
const dot = (a: [number, number, number], b: [number, number, number]) =>
  a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const finite = (v: [number, number, number]) => v.every(Number.isFinite);

/** Every corner normal on the mesh is finite and unit-length. */
function assertAllUnitFinite(m: HEMesh): void {
  const cn = m.computeCornerNormals();
  for (let h = 0; h < m.heCount; h++) {
    const v: [number, number, number] = [cn[h * 3]!, cn[h * 3 + 1]!, cn[h * 3 + 2]!];
    expect(finite(v), `corner ${h} finite`).toBe(true);
    expect(len(v), `corner ${h} unit`).toBeCloseTo(1, 4);
  }
}

const prim = (type: PrimitiveType) =>
  buildPrimitive({ type, params: primitiveDefaults[type] } as never);

describe("computeCornerNormals: all primitives are finite and unit-length", () => {
  const types: PrimitiveType[] = [
    "cube",
    "plane",
    "disc",
    "pyramid",
    "sphere",
    "cylinder",
    "cone",
    "capsule",
    "torus",
    "icosphere",
  ];
  for (const type of types) {
    it(`${type} — no NaN/zero normals (poles, apexes, seams)`, () => {
      assertAllUnitFinite(prim(type));
    });
  }
});

describe("computeCornerNormals: hard-surface faces stay flat", () => {
  it("cube — every corner normal axis-aligned; each face is flat (all corners equal)", () => {
    const faces = faceCornerNormals(prim("cube"));
    for (const { normals } of faces) {
      // face is flat: all corners share one normal
      for (const n of normals) {
        expect(dot(n, normals[0]!)).toBeCloseTo(1, 4);
        // axis-aligned: exactly one component ±1, others ~0 (no diagonal smear)
        const comps = n.map((c) => Math.abs(c)).sort((a, b) => b - a);
        expect(comps[0]).toBeCloseTo(1, 3);
        expect(comps[1]).toBeCloseTo(0, 3);
      }
    }
  });
});

describe("computeCornerNormals: curved faces smooth, caps stay flat", () => {
  it("sphere — interior corner normals point along the radius (smooth)", () => {
    const m = prim("sphere");
    const cn = m.computeCornerNormals();
    for (let h = 0; h < m.heCount; h++) {
      const v = m.heVert[h]!;
      const p: [number, number, number] = [m.vPos[v * 3]!, m.vPos[v * 3 + 1]!, m.vPos[v * 3 + 2]!];
      const pl = len(p) || 1;
      const radial: [number, number, number] = [p[0] / pl, p[1] / pl, p[2] / pl];
      const n: [number, number, number] = [cn[h * 3]!, cn[h * 3 + 1]!, cn[h * 3 + 2]!];
      expect(dot(n, radial)).toBeGreaterThan(0.99); // smooth sphere: normal ≈ position dir
    }
  });

  it("cylinder — walls are radial (smooth), caps are flat ±Y", () => {
    const m = prim("cylinder");
    const faces = faceCornerNormals(m);
    let walls = 0;
    let caps = 0;
    for (let f = 0; f < faces.length; f++) {
      const { faceDegree, normals } = faces[f]!;
      if (faceDegree === 4) {
        // wall quad: every corner normal is horizontal (|y|≈0) and outward
        walls++;
        for (const n of normals) {
          expect(Math.abs(n[1]), "wall normal horizontal").toBeLessThan(0.02);
        }
      } else {
        // cap n-gon: every corner normal ≈ (0, ±1, 0)
        caps++;
        for (const n of normals) {
          expect(Math.abs(n[1]), "cap normal axial").toBeGreaterThan(0.999);
        }
      }
    }
    expect(walls).toBeGreaterThan(0);
    expect(caps).toBe(2); // top + bottom
  });

  it("torus — every corner normal points out from the tube center", () => {
    const p = primitiveDefaults.torus;
    const m = prim("torus");
    const cn = m.computeCornerNormals();
    for (let h = 0; h < m.heCount; h++) {
      const v = m.heVert[h]!;
      const x = m.vPos[v * 3]!;
      const y = m.vPos[v * 3 + 1]!;
      const z = m.vPos[v * 3 + 2]!;
      // tube-center ring point at this vertex's azimuth, radius = p.radius
      const az = Math.atan2(z, x);
      const cx = p.radius * Math.cos(az);
      const cz = p.radius * Math.sin(az);
      const out: [number, number, number] = [x - cx, y, z - cz];
      const ol = len(out) || 1;
      const n: [number, number, number] = [cn[h * 3]!, cn[h * 3 + 1]!, cn[h * 3 + 2]!];
      expect(dot(n, [out[0] / ol, out[1] / ol, out[2] / ol])).toBeGreaterThan(0.98);
    }
  });
});

describe("computeCornerNormals: boolean output (Manifold-style welded triangle soup)", () => {
  it("welded cube soup → axis-aligned flat normals, no diagonal smear", () => {
    // 8 shared corners, 12 outward-CCW triangles — exactly the shape Manifold
    // returns from a boolean (indexed + welded), routed through trisToHEMesh.
    const s = 1;
    const positions = new Float32Array([
      -s,
      -s,
      -s,
      s,
      -s,
      -s,
      s,
      s,
      -s,
      -s,
      s,
      -s, // 0..3 back (z=-1)
      -s,
      -s,
      s,
      s,
      -s,
      s,
      s,
      s,
      s,
      -s,
      s,
      s, // 4..7 front (z=+1)
    ]);
    // prettier-ignore
    const triVerts = new Uint32Array([
      4, 5, 6, 4, 6, 7, // +z front
      1, 0, 3, 1, 3, 2, // -z back
      0, 4, 7, 0, 7, 3, // -x left
      5, 1, 2, 5, 2, 6, // +x right
      3, 7, 6, 3, 6, 2, // +y top
      0, 1, 5, 0, 5, 4, // -y bottom
    ]);
    const m = trisToHEMesh({ positions, triVerts });
    expect(m, "cube soup welds into a manifold HEMesh").not.toBeNull();
    assertAllUnitFinite(m!);
    const cn = m!.computeCornerNormals();
    for (let h = 0; h < m!.heCount; h++) {
      const n: [number, number, number] = [cn[h * 3]!, cn[h * 3 + 1]!, cn[h * 3 + 2]!];
      const comps = n.map((c) => Math.abs(c)).sort((a, b) => b - a);
      expect(comps[0], "one axis dominates").toBeCloseTo(1, 3);
      expect(comps[1], "no diagonal smear from shared corners").toBeCloseTo(0, 3);
    }
  });
});

describe("computeCornerNormals: spline extrude", () => {
  it("extruded square prism — walls lateral, caps axial along the extrude normal", () => {
    // a unit square on local XY (z=0), linear corners → a closed profile
    const corner = (x: number, y: number): SplineData["points"][number] => ({
      position: [x, y, 0],
      inHandle: [0, 0, 0],
      outHandle: [0, 0, 0],
      mode: "linear",
    });
    const spline: SplineData = {
      closed: true,
      points: [corner(-1, -1), corner(1, -1), corner(1, 1), corner(-1, 1)],
    };
    const m = buildSplineExtrude(spline, {
      depth: 2,
      heightSegments: 1,
      bevelSize: 0,
      bevelSegments: 1,
      caps: true,
    });
    expect(m, "square extrudes").not.toBeNull();
    assertAllUnitFinite(m!);
    // the extrude normal is local +Z; caps face ±Z, walls are ⊥Z
    const faces = faceCornerNormals(m!);
    let axialFaces = 0;
    let lateralFaces = 0;
    for (const { normals } of faces) {
      const allAxial = normals.every((n) => Math.abs(n[2]) > 0.99);
      const allLateral = normals.every((n) => Math.abs(n[2]) < 0.02);
      if (allAxial) axialFaces++;
      else if (allLateral) lateralFaces++;
    }
    expect(axialFaces, "two caps (±Z)").toBeGreaterThanOrEqual(2);
    expect(lateralFaces, "four walls ⊥Z").toBeGreaterThanOrEqual(4);
  });
});
