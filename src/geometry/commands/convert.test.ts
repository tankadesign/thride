import { describe, expect, it } from "vite-plus/test";
import { Document } from "@/core";
import { CreateNodeCommand } from "@/core/history/commands/scene";
import { defaultPrimitive } from "@/types/geometry/primitives";
import { meshRegistry } from "@/geometry/store/meshRegistry";
import { ConvertToMeshCommand } from "./convert";

const setup = () => {
  const doc = new Document();
  const create = new CreateNodeCommand("mesh", "Cube", null, undefined, {
    primitive: defaultPrimitive("cube"),
  });
  doc.history.run(create);
  return { doc, id: create.nodeId };
};

describe("ConvertToMeshCommand", () => {
  it("converts a primitive to a registered editable mesh, undo restores it", () => {
    const { doc, id } = setup();
    expect(ConvertToMeshCommand.eligible(doc, id)).toBe(true);

    doc.history.run(new ConvertToMeshCommand(doc, id));
    const meshRef = doc.scene.mustGet(id).data?.mesh as { id: string } | undefined;
    expect(meshRef).toBeDefined();
    expect(meshRegistry.has(meshRef!.id as never)).toBe(true);
    expect(doc.scene.mustGet(id).data?.primitive).toBeUndefined();
    expect(ConvertToMeshCommand.eligible(doc, id)).toBe(false); // skip on re-run

    doc.history.undo();
    expect(doc.scene.mustGet(id).data?.primitive).toBeDefined();
    expect(meshRegistry.has(meshRef!.id as never)).toBe(false);

    doc.history.redo();
    expect(doc.scene.mustGet(id).data?.mesh).toBeDefined();
    expect(meshRegistry.has(meshRef!.id as never)).toBe(true);
  });

  it("reports a real memory cost for the history budget", () => {
    const { doc, id } = setup();
    const cmd = new ConvertToMeshCommand(doc, id);
    expect(cmd.memoryCost).toBeGreaterThan(500); // cube kernel arrays (~728 B)
  });
});
