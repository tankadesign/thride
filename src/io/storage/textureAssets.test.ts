import { describe, expect, it } from "vite-plus/test";
import { defaultMaterialData, type MaterialDTO, type TextureAssetDTO } from "@/types/core";
import { Document } from "@/core/document/Document";
import { uuidv7 } from "@/core/ids/uuid";
import { hydrateProjectRecord, projectRecordOf, releaseProjectMeshes } from "./projectStore";
import { textureAssets, texturesOf } from "./textureAssets";

const asset = (name = "brick"): TextureAssetDTO => ({
  id: uuidv7(),
  name,
  mime: "image/png",
  bytes: new Uint8Array([1, 2, 3, 4]),
});

const matWith = (textures: MaterialDTO["textures"]): MaterialDTO => ({
  id: uuidv7(),
  name: "Mat",
  ...defaultMaterialData("physical"),
  textures,
});

describe("textureAssets registry", () => {
  it("register/get/has/unregister", () => {
    const a = asset();
    textureAssets.register(a);
    expect(textureAssets.has(a.id)).toBe(true);
    expect(textureAssets.get(a.id)?.name).toBe("brick");
    textureAssets.unregister(a.id);
    expect(textureAssets.has(a.id)).toBe(false);
  });

  it("texturesOf returns referenced ids across channels (and none when absent)", () => {
    const col = uuidv7();
    const rgh = uuidv7();
    expect(texturesOf(matWith({ map: col, roughnessMap: rgh })).sort()).toEqual([col, rgh].sort());
    expect(texturesOf(matWith(undefined))).toEqual([]);
    expect(texturesOf(matWith({}))).toEqual([]);
  });
});

describe("texture asset persistence round-trip", () => {
  it("projectRecordOf collects referenced assets; hydrate re-registers them", () => {
    const doc = new Document();
    const a = asset("wood");
    textureAssets.register(a);
    doc.addMaterial(matWith({ map: a.id }));
    // an unreferenced asset must NOT be captured in the record
    const orphan = asset("orphan");
    textureAssets.register(orphan);

    const rec = projectRecordOf(uuidv7(), "Proj", doc);
    expect(Object.keys(rec.textures ?? {})).toEqual([a.id]);
    expect(rec.textures?.[a.id]?.name).toBe("wood");

    // simulate a fresh session: clear the registry, then hydrate
    textureAssets.unregister(a.id);
    textureAssets.unregister(orphan.id);
    expect(textureAssets.has(a.id)).toBe(false);

    const dto = hydrateProjectRecord(rec);
    expect(dto).not.toBeNull();
    expect(textureAssets.has(a.id)).toBe(true);
    expect(textureAssets.get(a.id)?.bytes).toEqual(a.bytes);

    // closing the project releases its assets
    releaseProjectMeshes(dto!);
    expect(textureAssets.has(a.id)).toBe(false);
  });
});
