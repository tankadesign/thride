import { describe, expect, it } from "vite-plus/test";
import { defaultMaterialData } from "@/types/core";
import { uuidv7 } from "@/core/ids/uuid";
import {
  CreateMaterialCommand,
  DeleteMaterialCommand,
  UpdateMaterialCommand,
} from "@/core/history/commands/material";
import { Document } from "./Document";
import { MaterialStore } from "./MaterialStore";

const mat = (name = "Mat", color = "#ff0000") => ({
  id: uuidv7(),
  name,
  ...defaultMaterialData("physical"),
  color,
});

describe("MaterialStore", () => {
  it("stores copies and round-trips through DTO", () => {
    const s = new MaterialStore();
    const m = mat();
    s.set(m);
    m.color = "#00ff00"; // mutate caller's copy — store must be unaffected
    expect(s.get(m.id)?.color).toBe("#ff0000");
    expect(s.size).toBe(1);
    const restored = MaterialStore.fromDTO(s.toDTO());
    expect(restored.get(m.id)?.name).toBe("Mat");
    expect(restored.mustGet(m.id).type).toBe("physical");
  });

  it("fromDTO(undefined) is an empty library", () => {
    expect(MaterialStore.fromDTO(undefined).size).toBe(0);
  });
});

describe("Document material mutations + serialization", () => {
  it("add/update/remove bump the materials slice and events", () => {
    const doc = new Document();
    const events: string[] = [];
    doc.events.on("material:added", () => events.push("added"));
    doc.events.on("material:changed", () => events.push("changed"));
    doc.events.on("material:removed", () => events.push("removed"));
    const v0 = doc.version("materials");
    const m = mat();
    doc.addMaterial(m);
    doc.updateMaterial({ ...m, roughness: 0.1 });
    doc.removeMaterial(m.id);
    expect(events).toEqual(["added", "changed", "removed"]);
    expect(doc.version("materials")).toBe(v0 + 3);
    expect(doc.materials.size).toBe(0);
  });

  it("materials round-trip through toDTO/loadDTO", () => {
    const doc = new Document();
    const m = mat("Gold");
    doc.addMaterial(m);
    const dto = doc.toDTO();
    expect(dto.materials).toHaveLength(1);
    const doc2 = new Document();
    doc2.loadDTO(dto);
    expect(doc2.materials.get(m.id)?.name).toBe("Gold");
  });

  it("pre-material files (no materials field) load with an empty library", () => {
    const doc = new Document();
    doc.loadDTO({ formatVersion: "0.1.0", nodes: [] });
    expect(doc.materials.size).toBe(0);
  });
});

describe("material commands", () => {
  it("create/update/delete execute and undo", () => {
    const doc = new Document();
    const m = mat("Steel", "#888888");

    const create = new CreateMaterialCommand(m);
    create.execute(doc);
    expect(doc.materials.get(m.id)?.name).toBe("Steel");
    create.undo(doc);
    expect(doc.materials.has(m.id)).toBe(false);

    create.execute(doc); // redo
    const update = new UpdateMaterialCommand(m, { ...m, color: "#112233" });
    update.execute(doc);
    expect(doc.materials.get(m.id)?.color).toBe("#112233");
    update.undo(doc);
    expect(doc.materials.get(m.id)?.color).toBe("#888888");

    const del = new DeleteMaterialCommand(doc.materials.mustGet(m.id));
    del.execute(doc);
    expect(doc.materials.has(m.id)).toBe(false);
    del.undo(doc);
    expect(doc.materials.get(m.id)?.name).toBe("Steel");
  });

  it("update tryMerge coalesces same-material edits (scrub) only", () => {
    const m = mat();
    const a = new UpdateMaterialCommand(m, { ...m, roughness: 0.2 });
    const b = new UpdateMaterialCommand({ ...m, roughness: 0.2 }, { ...m, roughness: 0.4 });
    expect(a.tryMerge(b)).toBe(true);
    const other = new UpdateMaterialCommand(mat(), mat());
    expect(a.tryMerge(other)).toBe(false); // different material id
  });
});
