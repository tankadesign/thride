import { describe, expect, it } from "vite-plus/test";
import { Document, uniqueSiblingName } from "@/core";
import { CreateNodeCommand } from "@/core/history/commands/scene";
import { defaultPrimitive } from "@/types/geometry/primitives";
import { meshRegistry } from "@/geometry/store/meshRegistry";
import { ConvertToMeshCommand } from "./convert";
import { DuplicateSubtreeCommand } from "./duplicate";

describe("uniqueSiblingName", () => {
  it("suffixes on sibling conflicts only", () => {
    const doc = new Document();
    const a = new CreateNodeCommand("null", "Cube");
    doc.history.run(a);
    expect(uniqueSiblingName(doc, null, "Cube")).toBe("Cube.1");
    expect(uniqueSiblingName(doc, null, "Sphere")).toBe("Sphere");
    // same name under a DIFFERENT parent is fine
    expect(uniqueSiblingName(doc, a.nodeId, "Cube")).toBe("Cube");
    doc.history.run(new CreateNodeCommand("null", "Cube.1"));
    expect(uniqueSiblingName(doc, null, "Cube")).toBe("Cube.2");
  });
});

describe("DuplicateSubtreeCommand", () => {
  it("deep-copies a subtree with fresh ids, cloned meshes, unique root name", () => {
    const doc = new Document();
    const parent = new CreateNodeCommand("null", "Group");
    doc.history.run(parent);
    const child = new CreateNodeCommand("mesh", "Cube", parent.nodeId, undefined, {
      primitive: defaultPrimitive("cube"),
    });
    doc.history.run(child);
    doc.history.run(new ConvertToMeshCommand(doc, child.nodeId));
    const childMeshId = (doc.scene.mustGet(child.nodeId).data!.mesh as { id: string }).id;

    const dup = new DuplicateSubtreeCommand(doc, parent.nodeId, null);
    doc.history.run(dup);

    // copy exists at root with a unique name and remapped ids
    const copy = doc.scene.mustGet(dup.newRootId);
    expect(copy.name).toBe("Group.1");
    expect(dup.newRootId).not.toBe(parent.nodeId);
    const copyChildren = doc.scene.childrenOf(dup.newRootId);
    expect(copyChildren).toHaveLength(1);
    const copyMeshId = (doc.scene.mustGet(copyChildren[0]!).data!.mesh as { id: string }).id;
    expect(copyMeshId).not.toBe(childMeshId); // kernel mesh CLONED, not shared
    expect(meshRegistry.has(copyMeshId as never)).toBe(true);

    // undo removes the copy and its mesh clone
    doc.history.undo();
    expect(doc.scene.has(dup.newRootId)).toBe(false);
    expect(meshRegistry.has(copyMeshId as never)).toBe(false);
    expect(meshRegistry.has(childMeshId as never)).toBe(true); // original untouched
  });
});
