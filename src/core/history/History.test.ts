import { describe, expect, it } from "vite-plus/test";
import { Document } from "@/core/document/Document";
import type { Command } from "./Command";
import { History } from "./History";
import { CreateNodeCommand, RenameNodeCommand, SetTransformCommand } from "./commands/scene";

/** Dummy command mutating nothing — for stack/budget mechanics tests. */
const dummy = (cost?: number): Command => ({
  type: "test.dummy",
  label: "Dummy",
  memoryCost: cost,
  execute: () => {},
  undo: () => {},
});

const manualClock = () => {
  let t = 0;
  return { now: () => t, advance: (ms: number) => (t += ms) };
};

describe("History", () => {
  it("runs, undoes, and redoes commands; new pushes clear redo", () => {
    const doc = new Document();
    const h = new History(doc, undefined, { mergeWindowMs: -1 });

    const create = new CreateNodeCommand("mesh", "Cube");
    h.run(create);
    h.run(new RenameNodeCommand(create.nodeId, "Box"));
    expect(doc.scene.mustGet(create.nodeId).name).toBe("Box");

    h.undo();
    expect(doc.scene.mustGet(create.nodeId).name).toBe("Cube");
    expect(h.canRedo).toBe(true);

    h.run(new RenameNodeCommand(create.nodeId, "Crate"));
    expect(h.canRedo).toBe(false); // divergent branch discards redo

    h.undo();
    h.undo();
    expect(doc.scene.size).toBe(0);
    expect(h.canUndo).toBe(false);
  });

  it("merges same-node transform commands only within the time window", () => {
    const doc = new Document();
    const clock = manualClock();
    const h = new History(doc, undefined, { mergeWindowMs: 500, now: clock.now });
    const create = new CreateNodeCommand("mesh", "Cube");
    h.run(create);

    clock.advance(1000);
    h.run(
      new SetTransformCommand(create.nodeId, {
        position: [1, 0, 0],
        rotation: [0, 0, 0],
        scale: [1, 1, 1],
      }),
    );
    clock.advance(100); // within window → merges
    h.run(
      new SetTransformCommand(create.nodeId, {
        position: [2, 0, 0],
        rotation: [0, 0, 0],
        scale: [1, 1, 1],
      }),
    );
    expect(h.stats.steps).toBe(2); // create + one merged transform

    clock.advance(1000); // outside window → separate step
    h.run(
      new SetTransformCommand(create.nodeId, {
        position: [3, 0, 0],
        rotation: [0, 0, 0],
        scale: [1, 1, 1],
      }),
    );
    expect(h.stats.steps).toBe(3);

    h.undo(); // drops the [3,..] step
    h.undo(); // drops the merged step entirely
    expect(doc.scene.mustGet(create.nodeId).transform.position).toEqual([0, 0, 0]);
  });

  it("groups transact() into one step and rolls back on throw", () => {
    const doc = new Document();
    const h = new History(doc, undefined, { mergeWindowMs: -1 });

    h.transact("Add pair", () => {
      h.run(new CreateNodeCommand("mesh", "A"));
      h.transact("nested", () => h.run(new CreateNodeCommand("mesh", "B"))); // flattens
    });
    expect(doc.scene.size).toBe(2);
    expect(h.stats.steps).toBe(1);
    h.undo();
    expect(doc.scene.size).toBe(0);

    expect(() =>
      h.transact("Explodes", () => {
        h.run(new CreateNodeCommand("mesh", "C"));
        throw new Error("boom");
      }),
    ).toThrow("boom");
    expect(doc.scene.size).toBe(0); // rolled back
    expect(h.canRedo).toBe(true); // rollback leaves prior redo intact
    expect(h.stats.steps).toBe(0); // nothing recorded
  });

  it("evicts oldest steps over budget but never the newest", () => {
    const doc = new Document();
    const h = new History(doc, undefined, { budgetBytes: 1000, mergeWindowMs: -1 });
    h.run(dummy(400));
    h.run(dummy(400));
    h.run(dummy(400)); // 1200 > 1000 → oldest evicted
    expect(h.stats.steps).toBe(2);

    h.run(dummy(5000)); // oversized: evicts everything else, itself survives
    expect(h.stats.steps).toBe(1);

    h.setBudget(10_000);
    h.run(dummy(400));
    expect(h.stats.steps).toBe(2);
  });

  it("supports pushWithoutExecute for pre-applied interactive commits", () => {
    const doc = new Document();
    const h = new History(doc, undefined, { mergeWindowMs: -1 });
    const create = new CreateNodeCommand("mesh", "Cube");
    h.run(create);

    // simulate an interactive session: capture before at begin(), mutate live,
    // then commit the delta without re-executing
    const before = structuredClone(doc.scene.mustGet(create.nodeId).transform);
    doc.setNodeTransform(
      create.nodeId,
      { position: [9, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
      true,
    );
    h.pushWithoutExecute(
      new SetTransformCommand(
        create.nodeId,
        { position: [9, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
        before,
      ),
    );

    h.undo();
    expect(doc.scene.mustGet(create.nodeId).transform.position).toEqual([0, 0, 0]);
    h.redo();
    expect(doc.scene.mustGet(create.nodeId).transform.position).toEqual([9, 0, 0]);
  });

  it("forbids undo/redo inside a transaction", () => {
    const doc = new Document();
    const h = new History(doc, undefined, { mergeWindowMs: -1 });
    h.run(new CreateNodeCommand("mesh", "A"));
    expect(() => h.transact("bad", () => h.undo())).toThrow(/inside a transaction/);
  });

  it("bumps the history slice and emits history:changed via Document.history", () => {
    const doc = new Document();
    const events: { canUndo: boolean; canRedo: boolean }[] = [];
    doc.events.on("history:changed", (e) => events.push(e));
    const v = doc.version("history");

    const create = new CreateNodeCommand("mesh", "Cube");
    doc.history.run(create);
    doc.history.undo();
    doc.history.redo();

    expect(doc.version("history")).toBe(v + 3);
    expect(events).toEqual([
      { canUndo: true, canRedo: false },
      { canUndo: false, canRedo: true },
      { canUndo: true, canRedo: false },
    ]);
    expect(doc.history.undoLabel).toBe("Create Cube");
  });
});
