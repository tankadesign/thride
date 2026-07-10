import { describe, expect, it } from "vite-plus/test";
import { Document } from "@/core/document/Document";
import { CreateNodeCommand } from "@/core/history/commands/scene";
import { uuidv7 } from "@/core/ids/uuid";
import { uniqueEdges } from "@/geometry/kernel/components";
import { buildPrimitive } from "@/geometry/primitives";
import { meshRegistry } from "@/geometry/store/meshRegistry";
import { selectAll } from "./selectAll";

function cubeDoc() {
  const doc = new Document();
  const a = new CreateNodeCommand("mesh", "Cube A");
  const b = new CreateNodeCommand("mesh", "Cube B");
  doc.history.run(a);
  doc.history.run(b);
  const meshId = uuidv7();
  const mesh = buildPrimitive({ type: "cube", params: { width: 2, height: 2, depth: 2 } });
  meshRegistry.register(meshId, mesh);
  doc.setNodeData(a.nodeId, { mesh: { id: meshId } });
  return { doc, meshNode: a.nodeId, other: b.nodeId, mesh, meshId };
}

describe("selectAll", () => {
  it("object mode selects every scene node", () => {
    const { doc, meshNode, other } = cubeDoc();
    doc.selection.selectObjects([meshNode]);
    selectAll(doc);
    expect([...doc.selection.objectIds].sort()).toEqual([meshNode, other].sort());
  });

  it("point mode selects all vertices of the active mesh", () => {
    const { doc, meshNode, mesh } = cubeDoc();
    doc.selection.selectObjects([meshNode]);
    doc.selection.setEditMode("point");
    selectAll(doc);
    const sel = doc.selection.componentsFor(meshNode, "point");
    expect(sel?.bits.count).toBe(mesh.vCount);
    expect(sel?.topologyVersion).toBe(mesh.topologyVersion);
  });

  it("edge mode selects every unique edge", () => {
    const { doc, meshNode, mesh } = cubeDoc();
    doc.selection.selectObjects([meshNode]);
    doc.selection.setEditMode("edge");
    selectAll(doc);
    const sel = doc.selection.componentsFor(meshNode, "edge");
    expect(sel?.bits.count).toBe(uniqueEdges(mesh).length);
  });

  it("polygon mode selects every face", () => {
    const { doc, meshNode, mesh } = cubeDoc();
    doc.selection.selectObjects([meshNode]);
    doc.selection.setEditMode("polygon");
    selectAll(doc);
    const sel = doc.selection.componentsFor(meshNode, "polygon");
    expect(sel?.bits.count).toBe(mesh.fCount);
  });

  it("component mode is a no-op without an editable mesh under focus", () => {
    const { doc, other } = cubeDoc();
    doc.selection.selectObjects([other]); // Cube B has no registered mesh
    doc.selection.setEditMode("point");
    selectAll(doc);
    expect(doc.selection.componentsFor(other, "point")).toBeUndefined();
  });
});
