import type { Document } from "@/core/document/Document";
import { CompositeCommand, type Command } from "./Command";

export interface HistoryOptions {
  /** Retained-bytes cap for the undo stack. User-configurable via Settings (A6). */
  budgetBytes?: number;
  /** Max ms between pushes for tryMerge coalescing to apply. */
  mergeWindowMs?: number;
  /** Clock injection for tests. */
  now?: () => number;
}

/** Estimate for commands that don't report memoryCost (small DTO patches). */
const DEFAULT_COMMAND_COST = 512;
const DEFAULT_BUDGET_BYTES = 192 * 1024 * 1024;
const DEFAULT_MERGE_WINDOW_MS = 500;

/**
 * Single undo/redo stack spanning all document domains. Owned by Document;
 * all user-visible mutations flow through run()/transact() (or
 * pushWithoutExecute() from interactive sessions, chunk B3).
 */
export class History {
  private undoStack: Command[] = [];
  private redoStack: Command[] = [];
  private collector: Command[] | null = null;
  private lastPushAt = Number.NEGATIVE_INFINITY;
  private budgetBytes: number;
  private readonly mergeWindowMs: number;
  private readonly now: () => number;
  private readonly doc: Document;
  private readonly onChange: (() => void) | undefined;

  constructor(doc: Document, onChange?: () => void, options: HistoryOptions = {}) {
    this.doc = doc;
    this.onChange = onChange;
    this.budgetBytes = options.budgetBytes ?? DEFAULT_BUDGET_BYTES;
    this.mergeWindowMs = options.mergeWindowMs ?? DEFAULT_MERGE_WINDOW_MS;
    this.now = options.now ?? Date.now;
  }

  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  /** Labels for Edit-menu display. */
  get undoLabel(): string | null {
    return this.undoStack.at(-1)?.label ?? null;
  }

  get redoLabel(): string | null {
    return this.redoStack.at(-1)?.label ?? null;
  }

  get stats(): { steps: number; bytes: number; budgetBytes: number } {
    return {
      steps: this.undoStack.length,
      bytes: this.retainedBytes(),
      budgetBytes: this.budgetBytes,
    };
  }

  /** Execute a command and record it (or collect it inside a transaction). */
  run(cmd: Command): void {
    cmd.execute(this.doc);
    if (this.collector) {
      this.collector.push(cmd);
      return;
    }
    this.push(cmd);
  }

  /**
   * Record an already-applied command WITHOUT executing it — interactive
   * sessions mutate live during the drag and commit the final delta.
   */
  pushWithoutExecute(cmd: Command): void {
    if (this.collector) {
      this.collector.push(cmd);
      return;
    }
    this.push(cmd);
  }

  /**
   * Group every run()/pushWithoutExecute() inside `fn` into one undo step.
   * On throw: already-executed commands are undone in reverse, nothing is
   * recorded, and the error re-throws. Nested transactions flatten into the
   * outermost one.
   */
  transact(label: string, fn: () => void): void {
    if (this.collector) {
      fn(); // nested: flatten into the outer transaction
      return;
    }
    const collected: Command[] = [];
    this.collector = collected;
    try {
      fn();
    } catch (err) {
      this.collector = null;
      for (let i = collected.length - 1; i >= 0; i--) collected[i]!.undo(this.doc);
      throw err;
    }
    this.collector = null;
    if (collected.length === 0) return;
    this.push(collected.length === 1 ? collected[0]! : new CompositeCommand(label, collected));
  }

  undo(): boolean {
    if (this.collector) throw new Error("History: cannot undo inside a transaction");
    const cmd = this.undoStack.pop();
    if (!cmd) return false;
    cmd.undo(this.doc);
    this.redoStack.push(cmd);
    this.notify();
    return true;
  }

  redo(): boolean {
    if (this.collector) throw new Error("History: cannot redo inside a transaction");
    const cmd = this.redoStack.pop();
    if (!cmd) return false;
    cmd.execute(this.doc);
    this.undoStack.push(cmd);
    this.notify();
    return true;
  }

  /** Update the retained-bytes cap (Settings page); evicts immediately if over. */
  setBudget(bytes: number): void {
    this.budgetBytes = bytes;
    this.evict();
    this.notify();
  }

  clear(): void {
    this.undoStack = [];
    this.redoStack = [];
    this.lastPushAt = Number.NEGATIVE_INFINITY;
    this.notify();
  }

  private push(cmd: Command): void {
    this.redoStack = [];
    const top = this.undoStack.at(-1);
    const t = this.now();
    const withinWindow = t - this.lastPushAt <= this.mergeWindowMs;
    if (!(top && withinWindow && top.tryMerge?.(cmd))) {
      this.undoStack.push(cmd);
    }
    this.lastPushAt = t;
    this.evict();
    this.notify();
  }

  private retainedBytes(): number {
    let bytes = 0;
    for (const c of this.undoStack) bytes += c.memoryCost ?? DEFAULT_COMMAND_COST;
    return bytes;
  }

  /**
   * Drop oldest steps while over budget. The newest step always survives so
   * one oversized mesh snapshot cannot disable undo entirely.
   * TODO(B2+): compress evicted-candidate snapshots in a worker
   * (CompressionStream) before dropping them outright.
   */
  private evict(): void {
    while (this.undoStack.length > 1 && this.retainedBytes() > this.budgetBytes) {
      this.undoStack.shift();
    }
  }

  private notify(): void {
    this.onChange?.();
  }
}
