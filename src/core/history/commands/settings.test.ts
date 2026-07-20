import { describe, expect, it } from "vite-plus/test";
import { Document } from "@/core/document/Document";
import { SetEnvironmentCommand } from "./settings";

describe("SetEnvironmentCommand", () => {
  it("applies, undoes, and redoes an environment edit", () => {
    const doc = new Document();
    const before = { ...doc.environment };
    expect(doc.environment.background).toBe("color");

    doc.history.run(
      new SetEnvironmentCommand({ ...before, background: "transparent", intensity: 2 }, before),
    );
    expect(doc.environment.background).toBe("transparent");
    expect(doc.environment.intensity).toBe(2);

    doc.history.undo();
    expect(doc.environment.background).toBe("color");
    expect(doc.environment.intensity).toBe(before.intensity);

    doc.history.redo();
    expect(doc.environment.background).toBe("transparent");
    expect(doc.environment.intensity).toBe(2);
  });

  it("captures `before` lazily when not supplied (scrub-then-commit)", () => {
    const doc = new Document();
    const orig = doc.environment.rotation;
    doc.history.run(new SetEnvironmentCommand({ ...doc.environment, rotation: 90 }));
    expect(doc.environment.rotation).toBe(90);
    doc.history.undo();
    expect(doc.environment.rotation).toBe(orig);
  });

  it("merges a mergeable follow-up (one undo step for a slider drag)", () => {
    const doc = new Document();
    const before = { ...doc.environment };
    const first = new SetEnvironmentCommand({ ...before, intensity: 1 }, before);
    const next = new SetEnvironmentCommand(
      { ...before, intensity: 3 },
      { ...before, intensity: 1 },
    );
    expect(first.tryMerge(next)).toBe(true);
    first.execute(doc);
    expect(doc.environment.intensity).toBe(3); // absorbed next's `after`
    first.undo(doc);
    expect(doc.environment.intensity).toBe(before.intensity); // back to the pre-drag value
  });

  it("does not merge when either side is non-mergeable (discrete edits)", () => {
    const env = new Document().environment;
    const discrete = new SetEnvironmentCommand({ ...env }, env, "Edit Environment", false);
    const other = new SetEnvironmentCommand({ ...env }, env);
    expect(discrete.tryMerge(other)).toBe(false);
    expect(other.tryMerge(discrete)).toBe(false);
  });
});
