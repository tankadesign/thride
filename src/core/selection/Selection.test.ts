import { describe, expect, it } from "vite-plus/test";
import { Document } from "@/core/document/Document";
import { CreateNodeCommand } from "@/core/history/commands/scene";
import { Bitset } from "./Bitset";

const setup = () => {
  const doc = new Document();
  const ids = ["A", "B", "C"].map((n) => {
    const cmd = new CreateNodeCommand("mesh", n);
    doc.history.run(cmd);
    return cmd.nodeId;
  });
  return { doc, ids };
};

describe("Selection", () => {
  it("replace/add/toggle ops and active tracking", () => {
    const { doc, ids } = setup();
    const [a, b, c] = ids as [(typeof ids)[0], (typeof ids)[0], (typeof ids)[0]];
    doc.selection.selectObjects([a]);
    expect(doc.selection.objectIds).toEqual([a]);
    doc.selection.selectObjects([b], "add");
    expect(doc.selection.objectIds).toEqual([a, b]);
    expect(doc.selection.active).toBe(b);
    doc.selection.selectObjects([a], "toggle");
    expect(doc.selection.objectIds).toEqual([b]);
    doc.selection.selectObjects([c]);
    expect(doc.selection.objectIds).toEqual([c]);
  });

  it("bumps the selection slice and emits selection:changed", () => {
    const { doc, ids } = setup();
    const v = doc.version("selection");
    let events = 0;
    doc.events.on("selection:changed", () => events++);
    doc.selection.selectObjects([ids[0]!]);
    doc.selection.setEditMode("polygon");
    doc.selection.setEditMode("polygon"); // no-op, no event
    expect(doc.version("selection")).toBe(v + 2);
    expect(events).toBe(2);
  });

  it("prunes deleted nodes from the selection", () => {
    const { doc, ids } = setup();
    doc.selection.selectObjects(ids);
    doc.removeNode(ids[1]!);
    expect(doc.selection.objectIds).toEqual([ids[0], ids[2]]);
    expect(doc.selection.active).toBe(ids[2]);
  });
});

describe("per-mode component selection memory (C4D-style)", () => {
  const components = (mode: "point" | "edge" | "polygon", elems: number[]) => {
    const bits = new Bitset();
    for (const i of elems) bits.add(i);
    return { mode, bits, order: [...elems], topologyVersion: 0 };
  };

  it("each mode keeps its own selection on the same node; mode switches don't touch it", () => {
    const { doc, ids } = setup();
    const id = ids[0]!;
    doc.selection.setComponents(id, components("point", [1, 2]));
    doc.selection.setComponents(id, components("edge", [7]));
    doc.selection.setComponents(id, components("polygon", [3]));
    doc.selection.setEditMode("edge");
    doc.selection.setEditMode("point");
    expect(doc.selection.componentsFor(id, "point")?.bits.toArray()).toEqual([1, 2]);
    expect(doc.selection.componentsFor(id, "edge")?.bits.toArray()).toEqual([7]);
    expect(doc.selection.componentsFor(id, "polygon")?.bits.toArray()).toEqual([3]);
  });

  it("clearing one mode leaves the others intact", () => {
    const { doc, ids } = setup();
    const id = ids[0]!;
    doc.selection.setComponents(id, components("point", [1]));
    doc.selection.setComponents(id, components("edge", [2]));
    doc.selection.clearComponents(id, "point");
    expect(doc.selection.componentsFor(id, "point")).toBeUndefined();
    expect(doc.selection.componentsFor(id, "edge")?.bits.toArray()).toEqual([2]);
  });

  it("deleting the node drops every mode's selection for it", () => {
    const { doc, ids } = setup();
    const id = ids[0]!;
    doc.selection.setComponents(id, components("point", [1]));
    doc.selection.setComponents(id, components("edge", [2]));
    doc.removeNode(id);
    expect(doc.selection.componentsFor(id, "point")).toBeUndefined();
    expect(doc.selection.componentsFor(id, "edge")).toBeUndefined();
  });
});

describe("Bitset", () => {
  it("add/delete/has/count/forEach across word boundaries", () => {
    const b = new Bitset(8); // deliberately small: force growth
    const values = [0, 1, 31, 32, 33, 64, 1000];
    for (const v of values) b.add(v);
    expect(b.count).toBe(values.length);
    expect(values.every((v) => b.has(v))).toBe(true);
    expect(b.has(2)).toBe(false);
    b.delete(32);
    expect(b.has(32)).toBe(false);
    expect(b.toArray()).toEqual([0, 1, 31, 33, 64, 1000]);
    const clone = b.clone();
    clone.add(2);
    expect(b.has(2)).toBe(false); // clone is independent
  });
});
