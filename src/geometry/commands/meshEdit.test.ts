import { describe, expect, it } from "vite-plus/test";
import type { Uuid } from "@/types/core";
import { Document } from "@/core/document/Document";
import { CreateNodeCommand } from "@/core/history/commands/scene";
import { uuidv7 } from "@/core/ids/uuid";
import { buildPrimitive } from "@/geometry/primitives";
import { meshRegistry } from "@/geometry/store/meshRegistry";
import { ComponentTransformSession, SetMeshPositionsCommand } from "./meshEdit";

const setup = () => {
  const doc = new Document();
  const create = new CreateNodeCommand("mesh", "Cube");
  doc.history.run(create);
  const meshId = uuidv7();
  const mesh = buildPrimitive({ type: "cube", params: { width: 1, height: 1, depth: 1 } });
  meshRegistry.register(meshId, mesh);
  doc.setNodeData(create.nodeId, { mesh: { id: meshId } });
  return { doc, nodeId: create.nodeId, meshId, mesh };
};

const positionsOf = (meshId: Uuid, indices: number[]): number[] => {
  const mesh = meshRegistry.get(meshId)!;
  return indices.flatMap((v) => [mesh.vPos[v * 3]!, mesh.vPos[v * 3 + 1]!, mesh.vPos[v * 3 + 2]!]);
};

describe("SetMeshPositionsCommand", () => {
  it("execute/undo round-trips exact vertex positions", () => {
    const { doc, nodeId, meshId } = setup();
    const indices = [0, 2];
    const before = new Float32Array(positionsOf(meshId, indices));
    const after = before.map((v, i) => v + (i + 1) * 0.5);
    const cmd = new SetMeshPositionsCommand(nodeId, meshId, indices, before, after);

    doc.history.run(cmd);
    expect(positionsOf(meshId, indices)).toEqual([...after]);
    doc.history.undo();
    expect(positionsOf(meshId, indices)).toEqual([...before]);
    doc.history.redo();
    expect(positionsOf(meshId, indices)).toEqual([...after]);
  });

  it("reports a memory cost covering both buffers", () => {
    const { nodeId, meshId } = setup();
    const before = new Float32Array(6);
    const after = new Float32Array(6);
    const cmd = new SetMeshPositionsCommand(nodeId, meshId, [0, 1], before, after);
    expect(cmd.memoryCost).toBeGreaterThanOrEqual(before.byteLength + after.byteLength);
  });
});

describe("ComponentTransformSession", () => {
  it("a full drag is ONE history step; undo restores begin positions", () => {
    const { doc, nodeId, meshId } = setup();
    const indices = [0, 1, 4];
    const begin = positionsOf(meshId, indices);
    const steps = doc.history.stats.steps;
    const previews: boolean[] = [];
    doc.events.on("scene:node-changed", (e) => previews.push(e.preview ?? false));

    doc.sessions.start(new ComponentTransformSession(nodeId, meshId, indices));
    for (let step = 1; step <= 10; step++) {
      const p = new Float32Array(begin);
      for (let i = 0; i < indices.length; i++) p[i * 3] = p[i * 3]! + step * 0.1;
      doc.sessions.update(p);
    }
    doc.sessions.commit();

    expect(doc.history.stats.steps).toBe(steps + 1);
    expect(previews.filter(Boolean).length).toBe(10);
    const moved = positionsOf(meshId, indices);
    expect(moved[0]).toBeCloseTo(begin[0]! + 1.0, 5);

    doc.history.undo();
    expect(positionsOf(meshId, indices)).toEqual(begin);
    doc.history.redo();
    expect(positionsOf(meshId, indices)[0]).toBeCloseTo(begin[0]! + 1.0, 5);
  });

  it("cancel restores begin positions and records nothing", () => {
    const { doc, nodeId, meshId } = setup();
    const indices = [3];
    const begin = positionsOf(meshId, indices);
    const steps = doc.history.stats.steps;

    doc.sessions.start(new ComponentTransformSession(nodeId, meshId, indices));
    doc.sessions.update(new Float32Array([9, 9, 9]));
    doc.sessions.cancel();

    expect(positionsOf(meshId, indices)).toEqual(begin);
    expect(doc.history.stats.steps).toBe(steps);
  });

  it("a no-movement drag records nothing", () => {
    const { doc, nodeId, meshId } = setup();
    const steps = doc.history.stats.steps;
    doc.sessions.start(new ComponentTransformSession(nodeId, meshId, [0]));
    doc.sessions.commit();
    expect(doc.history.stats.steps).toBe(steps);
  });
});
