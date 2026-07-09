import { describe, expect, it } from "vite-plus/test";
import type { TransformDTO, Uuid } from "@/types/core";
import { Document } from "@/core/document/Document";
import { CreateNodeCommand } from "@/core/history/commands/scene";
import { TransformDragSession } from "./TransformDragSession";

const t = (x: number): TransformDTO => ({
  position: [x, 0, 0],
  rotation: [0, 0, 0],
  scale: [1, 1, 1],
});

const setup = () => {
  const doc = new Document();
  const create = new CreateNodeCommand("mesh", "Cube");
  doc.history.run(create);
  return { doc, id: create.nodeId };
};

describe("TransformDragSession via SessionRunner", () => {
  it("a full drag yields exactly one history entry and undoes to begin state", () => {
    const { doc, id } = setup();
    const stepsBefore = doc.history.stats.steps;
    const previews: boolean[] = [];
    doc.events.on("scene:node-changed", (e) => previews.push(e.preview ?? false));

    doc.sessions.start(new TransformDragSession([id], "Move"));
    for (let i = 1; i <= 20; i++) {
      doc.sessions.update(new Map([[id, t(i)]]));
    }
    doc.sessions.commit();

    expect(doc.history.stats.steps).toBe(stepsBefore + 1); // ONE entry for 20 updates
    expect(previews.filter(Boolean)).toHaveLength(20); // all drag updates preview-tagged
    expect(doc.scene.mustGet(id).transform.position).toEqual([20, 0, 0]);

    doc.history.undo();
    expect(doc.scene.mustGet(id).transform.position).toEqual([0, 0, 0]);
    doc.history.redo();
    expect(doc.scene.mustGet(id).transform.position).toEqual([20, 0, 0]);
  });

  it("cancel restores begin state exactly and records nothing", () => {
    const { doc, id } = setup();
    const before = structuredClone(doc.toDTO());
    const stepsBefore = doc.history.stats.steps;

    doc.sessions.start(new TransformDragSession([id]));
    doc.sessions.update(new Map([[id, t(99)]]));
    doc.sessions.cancel();

    expect(doc.toDTO()).toEqual(before);
    expect(doc.history.stats.steps).toBe(stepsBefore);
  });

  it("a no-movement drag records nothing", () => {
    const { doc, id } = setup();
    const stepsBefore = doc.history.stats.steps;
    doc.sessions.start(new TransformDragSession([id]));
    doc.sessions.commit();
    expect(doc.history.stats.steps).toBe(stepsBefore);
  });

  it("multi-node drags commit as one composite step", () => {
    const doc = new Document();
    const a = new CreateNodeCommand("mesh", "A");
    const b = new CreateNodeCommand("mesh", "B");
    doc.history.run(a);
    doc.history.run(b);
    const ids: Uuid[] = [a.nodeId, b.nodeId];

    doc.sessions.start(new TransformDragSession(ids, "Move 2"));
    doc.sessions.update(
      new Map([
        [a.nodeId, t(5)],
        [b.nodeId, t(7)],
      ]),
    );
    doc.sessions.commit();

    doc.history.undo(); // one undo reverts both
    expect(doc.scene.mustGet(a.nodeId).transform.position).toEqual([0, 0, 0]);
    expect(doc.scene.mustGet(b.nodeId).transform.position).toEqual([0, 0, 0]);
  });

  it("starting a new session cancels a stray active one", () => {
    const { doc, id } = setup();
    doc.sessions.start(new TransformDragSession([id]));
    doc.sessions.update(new Map([[id, t(50)]]));
    doc.sessions.start(new TransformDragSession([id])); // implicit cancel
    expect(doc.scene.mustGet(id).transform.position).toEqual([0, 0, 0]);
    doc.sessions.commit();
  });
});
