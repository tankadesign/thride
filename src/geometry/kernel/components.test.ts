import { describe, expect, it } from "vite-plus/test";
import { Bitset } from "@/core/selection/Bitset";
import { buildPrimitive } from "@/geometry/primitives";
import {
  canonicalEdge,
  edgeVerts,
  uniqueEdges,
  vertexCentroid,
  vertsForSelection,
} from "./components";

const cube = () => buildPrimitive({ type: "cube", params: { width: 2, height: 2, depth: 2 } });

describe("component addressing", () => {
  it("a cube has 12 unique edges, each with distinct endpoints", () => {
    const mesh = cube();
    const edges = uniqueEdges(mesh);
    expect(edges).toHaveLength(12);
    for (const h of edges) {
      const [a, b] = edgeVerts(mesh, h);
      expect(a).not.toBe(b);
      expect(canonicalEdge(mesh, h)).toBe(h);
      const twin = mesh.heTwin[h]!;
      if (twin !== -1) expect(canonicalEdge(mesh, twin)).toBe(h);
    }
  });

  it("point selection maps to itself; edge selection to its 2 verts", () => {
    const mesh = cube();
    const points = new Bitset();
    points.add(3);
    points.add(5);
    expect(vertsForSelection(mesh, "point", points).sort((x, y) => x - y)).toEqual([3, 5]);

    const edges = new Bitset();
    const h = uniqueEdges(mesh)[0]!;
    edges.add(h);
    const [a, b] = edgeVerts(mesh, h);
    expect(new Set(vertsForSelection(mesh, "edge", edges))).toEqual(new Set([a, b]));
  });

  it("polygon selection collects each face's verts once (shared verts deduped)", () => {
    const mesh = cube();
    const faces = new Bitset();
    faces.add(0);
    faces.add(1);
    const verts = vertsForSelection(mesh, "polygon", faces);
    expect(new Set(verts).size).toBe(verts.length); // no duplicates
    const union = new Set([...mesh.faceVertices(0), ...mesh.faceVertices(1)]);
    expect(new Set(verts)).toEqual(union);
  });

  it("centroid of a full cube selection is the origin", () => {
    const mesh = cube();
    const all = [...Array(mesh.vCount).keys()];
    const c = vertexCentroid(mesh, all);
    expect(c[0]).toBeCloseTo(0, 6);
    expect(c[1]).toBeCloseTo(0, 6);
    expect(c[2]).toBeCloseTo(0, 6);
  });
});
