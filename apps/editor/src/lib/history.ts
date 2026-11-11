/**
 * Undo/redo history for the project. Consecutive edits with the same coalesce key within a short time
 * (dragging, typing) become one undo step.
 */
import { useCallback, useRef, useState } from 'react';

export interface History<T> {
  past: T[];
  present: T;
  future: T[];
}

const LIMIT = 200;
const COALESCE_MS = 800;

export function pushState<T>(h: History<T>, next: T, coalesce: boolean): History<T> {
  if (next === h.present) return h;
  if (coalesce) return { past: h.past, present: next, future: [] };
  return { past: [...h.past, h.present].slice(-LIMIT), present: next, future: [] };
}

export function undoState<T>(h: History<T>): History<T> {
  const prev = h.past.at(-1);
  if (prev === undefined) return h;
  return { past: h.past.slice(0, -1), present: prev, future: [h.present, ...h.future] };
}

export function redoState<T>(h: History<T>): History<T> {
  const [next, ...rest] = h.future;
  if (next === undefined) return h;
  return { past: [...h.past, h.present], present: next, future: rest };
}

export function useHistory<T>(initial: T) {
  const [h, setH] = useState<History<T>>({ past: [], present: initial, future: [] });
  const last = useRef<{ key: string; at: number } | null>(null);
  const set = useCallback((fn: (prev: T) => T, coalesceKey?: string) => {
    setH((cur) => {
      const now = Date.now();
      const coalesce = !!coalesceKey && last.current?.key === coalesceKey && now - last.current.at < COALESCE_MS;
      last.current = coalesceKey ? { key: coalesceKey, at: now } : null;
      return pushState(cur, fn(cur.present), coalesce);
    });
  }, []);
  const undo = useCallback(() => { last.current = null; setH(undoState); }, []);
  const redo = useCallback(() => { last.current = null; setH(redoState); }, []);
  const reset = useCallback((value: T) => { last.current = null; setH({ past: [], present: value, future: [] }); }, []);
  return { state: h.present, set, undo, redo, reset, canUndo: h.past.length > 0, canRedo: h.future.length > 0 };
}
