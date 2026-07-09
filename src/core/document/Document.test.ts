import { describe, expect, it } from "vite-plus/test";
import { Document } from "./Document";

const build = () => {
  const doc = new Document();
  const root = doc.createNode("null", "Group");
  const cube = doc.createNode("mesh", "Cube", root.id);
  const sphere = doc.createNode("mesh", "Sphere", root.id);
  const cam = doc.createNode("camera", "Camera");
  return { doc, root, cube, sphere, cam };
};

describe("Document scene operations", () => {
  it("round-trips to DTO and back deep-equal", () => {
    const { doc, cube } = build();
    doc.setNodeTransform(cube.id, {
      position: [1, 2, 3],
      rotation: [0, Math.PI / 2, 0],
      scale: [2, 2, 2],
    });
    doc.setNodeFlags(cube.id, { visible: false });
    cube.data = { meshRef: "placeholder", nested: { keep: ["unknown", "keys"] } };

    const dto = doc.toDTO();
    const doc2 = new Document();
    doc2.loadDTO(structuredClone(dto));
    expect(doc2.toDTO()).toEqual(dto);
  });

  it("keeps sibling order through round-trip and reorder", () => {
    const { doc, root, cube, sphere } = build();
    expect(doc.scene.childrenOf(root.id)).toEqual([cube.id, sphere.id]);
    doc.reparentNode(sphere.id, root.id, 0);
    expect(doc.scene.childrenOf(root.id)).toEqual([sphere.id, cube.id]);

    const doc2 = new Document();
    doc2.loadDTO(doc.toDTO());
    expect(doc2.scene.childrenOf(root.id)).toEqual([sphere.id, cube.id]);
  });

  it("removes whole subtrees and reports them parents-first for undo", () => {
    const { doc, root, cube, sphere } = build();
    const removed = doc.removeNode(root.id);
    expect(removed.map((d) => d.id)).toEqual([root.id, cube.id, sphere.id]);
    expect(doc.scene.size).toBe(1); // camera remains
    expect(doc.scene.has(cube.id)).toBe(false);
  });

  it("restores removed subtrees from DTOs (undo path)", () => {
    const { doc, root } = build();
    const before = doc.toDTO();
    const removed = doc.removeNode(root.id);
    for (const dto of removed) doc.restoreNode(dto);
    // restored subtree appends to the end of its sibling list; content must match
    expect(doc.toDTO().nodes).toHaveLength(before.nodes.length);
    expect(new Set(doc.toDTO().nodes.map((n) => n.id))).toEqual(
      new Set(before.nodes.map((n) => n.id)),
    );
  });

  it("rejects reparenting under the node's own subtree", () => {
    const { doc, root, cube } = build();
    expect(() => doc.reparentNode(root.id, cube.id)).toThrow(/own subtree/);
  });

  it("bumps the scene slice version on every mutation, not others", () => {
    const { doc, cube } = build();
    const v = doc.version("scene");
    const vMat = doc.version("materials");
    doc.renameNode(cube.id, "Box");
    expect(doc.version("scene")).toBe(v + 1);
    expect(doc.version("materials")).toBe(vMat);
  });

  it("emits preview-tagged transform events for interactive drags", () => {
    const { doc, cube } = build();
    const previews: (boolean | undefined)[] = [];
    doc.events.on("scene:node-changed", (e) => previews.push(e.preview));
    doc.setNodeTransform(cube.id, cube.transform, true);
    doc.setNodeTransform(cube.id, cube.transform);
    expect(previews).toEqual([true, false]);
  });
});
