/** Tiny typed event emitter (no Node dependency, listener errors are isolated). */
export class Emitter<Events extends Record<string, unknown>> {
  private listeners = new Map<keyof Events, Set<(payload: never) => void>>();

  on<K extends keyof Events>(event: K, fn: (payload: Events[K]) => void): () => void {
    let set = this.listeners.get(event);
    if (!set) this.listeners.set(event, (set = new Set()));
    set.add(fn as (payload: never) => void);
    return () => set!.delete(fn as (payload: never) => void);
  }

  emit<K extends keyof Events>(event: K, payload: Events[K]): void {
    for (const fn of this.listeners.get(event) ?? []) {
      try {
        (fn as (p: Events[K]) => void)(payload);
      } catch (err) {
        console.error(`listener for "${String(event)}" failed`, err);
      }
    }
  }
}
