import { useEffect, useRef, useState } from 'react';

/** Re-renders every `ms` milliseconds and returns Date.now(). */
export function useNow(ms = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

/** useState backed by localStorage (never throws). */
export function useStored<T>(key: string, initial: T): [T, (v: T) => void] {
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(key);
      return raw === null ? initial : (JSON.parse(raw) as T);
    } catch {
      return initial;
    }
  });
  const set = (v: T) => {
    setValue(v);
    try {
      localStorage.setItem(key, JSON.stringify(v));
    } catch {
      /* private mode */
    }
  };
  return [value, set];
}

/** Calls the latest `fn` after `ms` of inactivity; returns [schedule, flush]. */
export function useDebounced<A extends unknown[]>(fn: (...args: A) => void, ms: number): [(...args: A) => void, () => void] {
  const fnRef = useRef(fn);
  fnRef.current = fn;
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const pending = useRef<A | undefined>(undefined);
  const flush = () => {
    clearTimeout(timer.current);
    if (pending.current) {
      const args = pending.current;
      pending.current = undefined;
      fnRef.current(...args);
    }
  };
  useEffect(() => flush, []); // flush on unmount
  return [
    (...args: A) => {
      pending.current = args;
      clearTimeout(timer.current);
      timer.current = setTimeout(flush, ms);
    },
    flush,
  ];
}

/** Observes an element's size. */
export function useSize<T extends HTMLElement>(): [React.RefObject<T | null>, { width: number; height: number }] {
  const ref = useRef<T>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => e && setSize({ width: e.contentRect.width, height: e.contentRect.height }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, size];
}
