import type { Document } from "@/core/document/Document";

/**
 * A single undoable mutation. Commands capture ids + DTOs only — never live
 * object references (a live ref resurrected after undo-of-delete is a stale
 * object bug). `execute` must be re-runnable for redo.
 */
export interface Command {
  /** Stable machine id, e.g. "scene.setTransform" — used by tryMerge same-kind checks. */
  readonly type: string;
  /** Human label for the Edit menu ("Undo Move Cube"). */
  readonly label: string;
  execute(doc: Document): void;
  undo(doc: Document): void;
  /**
   * Attempt to absorb `next` (already executed) into this command so a
   * slider drag reads as one undo step. Return true if absorbed. History
   * additionally bounds merging by a time window.
   */
  tryMerge?(next: Command): boolean;
  /**
   * Approximate retained bytes (mesh snapshots and similar heavyweights
   * must report this). Used for the history memory budget.
   */
  readonly memoryCost?: number;
}

/** Several commands grouped as one undo step (History.transact). */
export class CompositeCommand implements Command {
  readonly type = "composite";
  readonly label: string;
  private readonly commands: readonly Command[];

  constructor(label: string, commands: readonly Command[]) {
    this.label = label;
    this.commands = commands;
  }

  get memoryCost(): number {
    let total = 0;
    for (const c of this.commands) total += c.memoryCost ?? 0;
    return total;
  }

  execute(doc: Document): void {
    for (const c of this.commands) c.execute(doc);
  }

  undo(doc: Document): void {
    for (let i = this.commands.length - 1; i >= 0; i--) this.commands[i]!.undo(doc);
  }
}
