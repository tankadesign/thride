import { describe, expect, it } from "vite-plus/test";
import { defaultPrimitive } from "@/types/geometry/primitives";
import { DIRTY_POSITIONS } from "@/types/geometry/mesh";
import { HEMesh } from "@/geometry/kernel/HEMesh";
import { buildPrimitive } from "@/geometry/primitives";
import { RenderMesh } from "./RenderMesh";
import { triangulate } from "./triangulate";

describe("triangulate", () => {
  it("covers every face: tri/quad/n-gon counts add up", () => {
    const cube = buildPrimitive(defaultPrimitive("cube")); // 6 quads → 12 tris
    expect(triangulate(cube).triCount).toBe(12);

    // hexagon n-gon (the disc is fan-triangulated now, so earcut needs its own case)
    const hexagon = HEMesh.fromPolygons({
      positions: Array.from({ length: 6 }, (_, k) => {
        const phi = (-k / 6) * Math.PI * 2;
        return [Math.cos(phi), 0, Math.sin(phi)];
      }).flat(),
      faces: [[0, 1, 2, 3, 4, 5]],
    });
    expect(triangulate(hexagon).triCount).toBe(4); // 6-gon → 4 tris

    const disc = buildPrimitive({ type: "disc", params: { radius: 1, segments: 12, rings: 2 } });
    expect(triangulate(disc).triCount).toBe(12 + 24); // 12 fan tris + 12 band quads

    const cone = buildPrimitive({
      type: "cone",
      params: { radius: 1, height: 2, segments: 8, capped: true },
    });
    // 8 side tris + 8-gon cap (6 tris)
    expect(triangulate(cone).triCount).toBe(14);
  });

  it("maps triangles back to kernel faces", () => {
    const cube = buildPrimitive(defaultPrimitive("cube"));
    const tri = triangulate(cube);
    for (let f = 0; f < 6; f++) {
      expect([...tri.triFace].filter((x) => x === f)).toHaveLength(2);
    }
  });
});

describe("RenderMesh sync", () => {
  it("builds attributes sized to the triangulation", () => {
    const mesh = buildPrimitive(defaultPrimitive("sphere"));
    const rm = new RenderMesh();
    rm.sync(mesh);
    const pos = rm.geometry.getAttribute("position");
    expect(pos.count).toBe(rm.triFace.length * 3);
    expect(rm.geometry.getAttribute("uv").count).toBe(pos.count);
    expect(mesh.dirty).toBe(0); // sync cleared dirty
  });

  it("POSITIONS dirty updates positions in place without retriangulating", () => {
    const mesh = buildPrimitive(defaultPrimitive("cube"));
    const rm = new RenderMesh();
    rm.sync(mesh);
    const triFaceBefore = rm.triFace;

    mesh.setPosition(0, -5, -5, -5);
    expect(mesh.dirty & DIRTY_POSITIONS).toBeTruthy();
    rm.sync(mesh);

    expect(rm.triFace).toBe(triFaceBefore); // same triangulation object → no rebuild
    const pos = rm.geometry.getAttribute("position");
    // some corner must now carry the moved position
    let found = false;
    for (let c = 0; c < pos.count; c++) {
      if (pos.getX(c) === -5 && pos.getY(c) === -5 && pos.getZ(c) === -5) found = true;
    }
    expect(found).toBe(true);
  });

  it("topology change (restore) triggers a rebuild", () => {
    const mesh = buildPrimitive(defaultPrimitive("cube"));
    const rm = new RenderMesh();
    rm.sync(mesh);
    const before = rm.triFace;
    mesh.restore(mesh.snapshot()); // bumps topologyVersion
    rm.sync(mesh);
    expect(rm.triFace).not.toBe(before);
  });

  it("rebuild REPLACES the geometry object; positions-only keeps it", () => {
    // swapping different-sized attributes on one BufferGeometry leaves
    // three's WebGPU backend drawing stale cached buffers — rebuilds must
    // hand consumers a FRESH geometry (the primitive-param stale-face bug)
    const mesh = buildPrimitive(defaultPrimitive("cube"));
    const rm = new RenderMesh();
    rm.sync(mesh);
    const g0 = rm.geometry;
    mesh.setPosition(0, 1, 2, 3);
    rm.sync(mesh);
    expect(rm.geometry).toBe(g0); // in-place path: same buffers, updated
    mesh.restore(mesh.snapshot()); // topology rebuild
    rm.sync(mesh);
    expect(rm.geometry).not.toBe(g0);
    // a fresh primitive mesh (same topologyVersion, DIRTY_ALL) also rebuilds fresh
    const g1 = rm.geometry;
    const bigger = buildPrimitive({
      type: "disc",
      params: { radius: 1, segments: 48, rings: 3 },
    });
    rm.sync(bigger);
    expect(rm.geometry).not.toBe(g1);
    expect(rm.geometry.getAttribute("position").count).toBe(rm.triFace.length * 3);
  });
});
