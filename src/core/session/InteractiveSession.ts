import type { Document } from "@/core/document/Document";
import type { Command } from "@/core/history/Command";

/**
 * Preview→commit lifecycle for every drag interaction (gizmo, sliders,
 * curve handles, extrude drags). During the drag the session mutates the
 * document directly with preview-tagged events (no history); commit()
 * returns ONE command built from begin-captured state, pushed without
 * re-executing; cancel() restores the begin state exactly.
 */
export interface InteractiveSession<TInput> {
  readonly label: string;
  begin(doc: Document): void;
  update(doc: Document, input: TInput): void;
  /** Build the single undo step. Return null if nothing changed. */
  commit(doc: Document): Command | null;
  cancel(doc: Document): void;
}

/** Enforces the session lifecycle; owned by Document. One session at a time. */
export class SessionRunner {
  private readonly doc: Document;
  private active: InteractiveSession<unknown> | null = null;

  constructor(doc: Document) {
    this.doc = doc;
  }

  get isActive(): boolean {
    return this.active !== null;
  }

  start<TInput>(session: InteractiveSession<TInput>): void {
    if (this.active) {
      // a stray pointerdown during an active drag: cancel the old one first
      this.cancel();
    }
    session.begin(this.doc);
    this.active = session as InteractiveSession<unknown>;
  }

  update<TInput>(input: TInput): void {
    if (!this.active) throw new Error("SessionRunner: update without active session");
    this.active.update(this.doc, input);
  }

  /** Commit as one history entry (no-op entry suppressed when commit() returns null). */
  commit(): void {
    if (!this.active) throw new Error("SessionRunner: commit without active session");
    const session = this.active;
    this.active = null;
    const cmd = session.commit(this.doc);
    if (cmd) this.doc.history.pushWithoutExecute(cmd);
  }

  /** Esc / pointer-capture loss: restore begin state, record nothing. */
  cancel(): void {
    if (!this.active) return;
    const session = this.active;
    this.active = null;
    session.cancel(this.doc);
  }
}
