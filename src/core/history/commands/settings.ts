import type { EnvironmentDTO } from "@/types/core";
import type { Document } from "@/core/document/Document";
import type { Command } from "@/core/history/Command";

/**
 * Undoable environment (dome-light / background) edit. Stores full before/after
 * snapshots — the DTO is tiny, so this is simpler than tracking dirty keys and
 * lets one command cover any mix of changes. `before` is captured lazily on
 * first execute (so a scrub can push after the previews already applied), and
 * same-kind commands merge inside History's time window so a slider drag is one
 * undo step (pass `mergeable: false` for discrete edits that must stay distinct).
 */
export class SetEnvironmentCommand implements Command {
  readonly type = "settings.environment";
  readonly label: string;
  private after: EnvironmentDTO;
  private before: EnvironmentDTO | null;
  private readonly mergeable: boolean;

  constructor(
    after: EnvironmentDTO,
    before: EnvironmentDTO | null = null,
    label = "Edit Environment",
    mergeable = true,
  ) {
    this.after = { ...after };
    this.before = before ? { ...before } : null;
    this.label = label;
    this.mergeable = mergeable;
  }

  execute(doc: Document): void {
    this.before ??= { ...doc.environment };
    doc.setEnvironment(this.after);
  }

  undo(doc: Document): void {
    if (this.before) doc.setEnvironment(this.before);
  }

  tryMerge(next: Command): boolean {
    if (!(next instanceof SetEnvironmentCommand)) return false;
    if (!this.mergeable || !next.mergeable) return false;
    this.after = next.after;
    return true;
  }
}
