type Listener<T> = (payload: T) => void;

/**
 * Minimal typed event emitter. Listeners are isolated: one throwing listener
 * never prevents the rest from running (an editor must not wedge on a bad
 * panel subscription).
 */
export class EventBus<TMap extends Record<string, unknown>> {
  private listeners = new Map<keyof TMap, Set<Listener<never>>>();

  /** Subscribe; returns an unsubscribe function. */
  on<K extends keyof TMap>(type: K, fn: Listener<TMap[K]>): () => void {
    let set = this.listeners.get(type);
    if (!set) {
      set = new Set();
      this.listeners.set(type, set);
    }
    set.add(fn as Listener<never>);
    return () => set.delete(fn as Listener<never>);
  }

  emit<K extends keyof TMap>(type: K, payload: TMap[K]): void {
    const set = this.listeners.get(type);
    if (!set) return;
    for (const fn of [...set]) {
      try {
        (fn as Listener<TMap[K]>)(payload);
      } catch (err) {
        console.error(`[EventBus] listener for "${String(type)}" threw`, err);
      }
    }
  }

  clear(): void {
    this.listeners.clear();
  }
}
