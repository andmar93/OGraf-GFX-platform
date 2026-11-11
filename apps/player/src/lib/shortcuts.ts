/**
 * Keyboard shortcuts of the player. Pure mapping so it can be tested and shown in the help dialog.
 */
export type ShortcutAction =
  | 'take' | 'cue' | 'next' | 'prev' | 'out' | 'update' | 'outAll' | 'clearAll'
  | 'selectUp' | 'selectDown' | 'moveUp' | 'moveDown' | 'duplicate' | 'delete' | 'help';

export const SHORTCUTS: { keys: string; action: ShortcutAction; label: string }[] = [
  { keys: 'Space / F2', action: 'take', label: 'Take selected item (multi-step on air: next step)' },
  { keys: 'C / F3', action: 'cue', label: 'Cue (load without playing)' },
  { keys: '→', action: 'next', label: 'Next step' },
  { keys: '←', action: 'prev', label: 'Previous step' },
  { keys: 'O / F1 / Esc', action: 'out', label: 'Out (selected item, else last taken)' },
  { keys: 'U / F6', action: 'update', label: 'Update on-air item with edited data' },
  { keys: 'Shift+O', action: 'outAll', label: 'Out all layers on the program channel' },
  { keys: 'Shift+Esc', action: 'clearAll', label: 'Clear program channel (panic, no animation)' },
  { keys: '↑ / ↓', action: 'selectUp', label: 'Select previous / next item' },
  { keys: 'Alt+↑ / Alt+↓', action: 'moveUp', label: 'Move item up / down' },
  { keys: 'Ctrl/⌘+D', action: 'duplicate', label: 'Duplicate item' },
  { keys: 'Delete', action: 'delete', label: 'Delete item' },
  { keys: '?', action: 'help', label: 'Show shortcuts' },
];

export interface KeyLike {
  key: string;
  shiftKey?: boolean;
  altKey?: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
}

export function shortcutFor(e: KeyLike): ShortcutAction | undefined {
  const mod = e.ctrlKey || e.metaKey;
  const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  if (mod) return k === 'd' ? 'duplicate' : undefined;
  if (e.altKey) return k === 'ArrowUp' ? 'moveUp' : k === 'ArrowDown' ? 'moveDown' : undefined;
  if (e.shiftKey) {
    if (k === 'o') return 'outAll';
    if (k === 'Escape') return 'clearAll';
    if (e.key === '?') return 'help';
    return undefined;
  }
  switch (k) {
    case ' ':
    case 'F2': return 'take';
    case 'c':
    case 'F3': return 'cue';
    case 'ArrowRight': return 'next';
    case 'ArrowLeft': return 'prev';
    case 'o':
    case 'F1':
    case 'Escape': return 'out';
    case 'u':
    case 'F6': return 'update';
    case 'ArrowUp': return 'selectUp';
    case 'ArrowDown': return 'selectDown';
    case 'Delete': return 'delete';
    case '?': return 'help';
    default: return undefined;
  }
}

/** True when the key event should be left to a form control. */
export function isTypingTarget(el: EventTarget | null): boolean {
  if (!el || typeof (el as HTMLElement).tagName !== 'string') return false;
  const t = el as HTMLElement;
  const tag = t.tagName.toLowerCase();
  if (t.isContentEditable) return true;
  if (tag === 'textarea' || tag === 'select') return true;
  if (tag === 'input') {
    const type = ((t as HTMLInputElement).type || 'text').toLowerCase();
    return !['checkbox', 'radio', 'button', 'submit', 'range', 'color'].includes(type);
  }
  return false;
}
