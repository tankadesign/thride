import { describe, expect, it } from "vite-plus/test";
import { defaultPrimitive } from "@/types/geometry/primitives";
import { DIRTY_POSITIONS } from "@/types/geometry/mesh";
import { buildPrimitive } from "@/geometry/primitives";
import { RenderMesh } from "./RenderMesh";
import { triangulate } from "./triangulate";

describe("triangulate", () => {
  it("covers every face: tri/quad/n-gon counts add up", () => {
    const cube = buildPrimitive(defaultPrimitive("cube")); // 6 quads → 12 tris
    expect(triangulate(cube).triCount).toBe(12);

    const disc = buildPrimitive({ type: "disc", params: { radius: 1, segments: 12 } }); // 12-gon → 10 tris
    expect(triangulate(disc).triCount).toBe(10);

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
});
