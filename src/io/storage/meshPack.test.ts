import { describe, expect, it } from "vite-plus/test";
import { buildPrimitive } from "@/geometry/primitives";
import { packMesh, unpackMesh } from "./meshPack";

describe("meshPack (interim autosave mesh serialization)", () => {
  it("round-trips an edited mesh bit-exactly through JSON", () => {
    const mesh = buildPrimitive({ type: "sphere", params: { radius: 1, segments: 12, rings: 8 } });
    mesh.setPosition(3, 0.123456, -4.5, 7.75); // an edit that must survive

    const json = JSON.stringify(packMesh(mesh));
    const restored = unpackMesh(JSON.parse(json));

    expect(restored.vCount).toBe(mesh.vCount);
    expect(restored.heCount).toBe(mesh.heCount);
    expect(restored.fCount).toBe(mesh.fCount);
    expect([...restored.vPos]).toEqual([...mesh.vPos]);
    expect([...restored.heNext]).toEqual([...mesh.heNext]);
    expect([...restored.heTwin]).toEqual([...mesh.heTwin]);
    expect([...restored.heVert]).toEqual([...mesh.heVert]);
    expect([...restored.heFace]).toEqual([...mesh.heFace]);
    expect([...restored.heUV]).toEqual([...mesh.heUV]);
    expect([...restored.vHE]).toEqual([...mesh.vHE]);
    expect([...restored.fHE]).toEqual([...mesh.fHE]);
    expect(restored.getPosition(3)).toEqual(mesh.getPosition(3));
  });

  it("throws on truncated data instead of building a broken mesh", () => {
    const packed = packMesh(
      buildPrimitive({ type: "cube", params: { width: 1, height: 1, depth: 1 } }),
    );
    packed.vPos = packed.vPos.slice(0, 8);
    expect(() => unpackMesh(packed)).toThrow();
  });
});
