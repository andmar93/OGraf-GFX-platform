import { useSyncExternalStore } from 'react';

export interface Toast {
  id: number;
  kind: 'error' | 'warn' | 'info';
  text: string;
}

let toasts: Toast[] = [];
let seq = 0;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((fn) => fn());

export function toast(kind: Toast['kind'], text: string, ms = kind === 'error' ? 6000 : 3500) {
  const t = { id: ++seq, kind, text };
  toasts = [...toasts.slice(-4), t];
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

/** Runs an async action and reports failures / graphic errors / data warnings as toasts. */
export async function run<T extends { statusCode?: number; statusMessage?: string; dataWarnings?: { path: string; message: string }[] }>(
  label: string,
  fn: () => Promise<T>,
): Promise<T | undefined> {
  try {
    const r = await fn();
    if (r && typeof r.statusCode === 'number' && r.statusCode >= 400) toast('error', `${label}: ${r.statusMessage ?? `status ${r.statusCode}`}`);
    if (r?.dataWarnings?.length) toast('warn', `${label}: data does not match the graphic's schema – ${r.dataWarnings.map((w) => `${w.path || '/'} ${w.message}`).join('; ')}`);
    return r;
  } catch (err) {
    toast('error', `${label}: ${(err as Error).message}`);
    return undefined;
  }
}
