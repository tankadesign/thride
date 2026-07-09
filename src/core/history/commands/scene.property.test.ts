import { describe, expect, it } from "vite-plus/test";
import type { ThrideDocumentDTO, Uuid } from "@/types/core";
import { Document } from "@/core/document/Document";
import type { Command } from "../Command";
import { History } from "../History";
import {
  CreateNodeCommand,
  RemoveNodeCommand,
  RenameNodeCommand,
  ReparentNodeCommand,
  SetFlagsCommand,
  SetTransformCommand,
} from "./scene";

/** Deterministic PRNG (mulberry32) so failures reproduce from the logged seed. */
const mulberry32 = (seed: number) => () => {
  seed |= 0;
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

const KINDS = ["null", "mesh", "spline", "light", "camera"] as const;

/** Build a random valid command against the document's current state. */
function randomCommand(doc: Document, rnd: () => number): Command {
  const ids = doc.toDTO().nodes.map((n) => n.id);
  const pick = <T>(arr: readonly T[]): T => arr[Math.floor(rnd() * arr.length)]!;
  const maybeParent = (): Uuid | null => (ids.length && rnd() < 0.5 ? pick(ids) : null);

  // with no nodes, only creation is valid
  const roll = ids.length === 0 ? 0 : rnd();

  if (roll < 0.35) {
    return new CreateNodeCommand(pick(KINDS), `N${Math.floor(rnd() * 1e6)}`, maybeParent());
  }
  const id = pick(ids);
  if (roll < 0.45) return new RemoveNodeCommand(id);
  if (roll < 0.6) {
    // find a reparent target that is not inside id's own subtree
    const candidates = ids.filter((t) => !doc.scene.isAncestorOrSelf(id, t));
    const target = candidates.length && rnd() < 0.8 ? pick(candidates) : null;
    return new ReparentNodeCommand(id, target, Math.floor(rnd() * 4));
  }
  if (roll < 0.75) return new RenameNodeCommand(id, `R${Math.floor(rnd() * 1e6)}`);
  if (roll < 0.9) {
    return new SetTransformCommand(id, {
      position: [rnd() * 10, rnd() * 10, rnd() * 10],
      rotation: [rnd() * Math.PI, rnd() * Math.PI, rnd() * Math.PI],
      scale: [0.5 + rnd(), 0.5 + rnd(), 0.5 + rnd()],
    });
  }
  return new SetFlagsCommand(id, { visible: rnd() < 0.5, locked: rnd() < 0.5 });
}

const OPS_PER_RUN = 150;
const SEEDS = [1, 42, 1337, 20260709];

describe("scene commands: property-based undo/redo convergence", () => {
  for (const seed of SEEDS) {
    it(`random sequence converges (seed ${seed})`, () => {
      const rnd = mulberry32(seed);
      const doc = new Document();
      // standalone stack with merging disabled so depth === snapshot index
      const h = new History(doc, undefined, { mergeWindowMs: -1 });

      // snapshots[d] = document state at history depth d
      const snapshots: ThrideDocumentDTO[] = [structuredClone(doc.toDTO())];
      for (let i = 0; i < OPS_PER_RUN; i++) {
        h.run(randomCommand(doc, rnd));
        snapshots.push(structuredClone(doc.toDTO()));
      }
      let depth = OPS_PER_RUN;

      // random undo/redo walk must always land exactly on the snapshot
      for (let step = 0; step < 200; step++) {
        if (rnd() < 0.5 && depth > 0) {
          h.undo();
          depth--;
        } else if (depth < OPS_PER_RUN) {
          h.redo();
          depth++;
        }
        expect(doc.toDTO()).toEqual(snapshots[depth]);
      }

      // full unwind to genesis, full replay to head
      while (h.canUndo) h.undo();
      expect(doc.toDTO()).toEqual(snapshots[0]);
      while (h.canRedo) h.redo();
      expect(doc.toDTO()).toEqual(snapshots[OPS_PER_RUN]);
    });
  }
});
