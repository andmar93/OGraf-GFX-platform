import { useSyncExternalStore } from 'react';

export interface Toast {
  id: number;
  kind: 'error' | 'warn' | 'info';
  text: string;
  action?: { label: string; run: () => void };
}

let toasts: Toast[] = [];
let seq = 0;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((fn) => fn());

export function toast(kind: Toast['kind'], text: string, ms = kind === 'error' ? 6000 : 3500, action?: Toast['action']) {
  const t: Toast = { id: ++seq, kind, text, ...(action ? { action } : {}) };
  toasts = [...toasts.slice(-1), t];
  emit();
  setTimeout(() => dismiss(t.id), ms);
}

export function dismiss(id: number) {
  toasts = toasts.filter((t) => t.id !== id);
  emit();
}

export function useToasts(): Toast[] {
  return useSyncExternalStore((fn) => (listeners.add(fn), () => listeners.delete(fn)), () => toasts);
}
