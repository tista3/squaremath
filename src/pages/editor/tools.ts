// Editor tools and keyboard shortcut mapping (pure).
import type { IconName } from '../../components/Icon';

export type Tool = 'pencil' | 'eraser' | 'fill' | 'picker';

export const TOOLS: { tool: Tool; icon: IconName; key: string }[] = [
  { tool: 'pencil', icon: 'pencil', key: 'B' },
  { tool: 'eraser', icon: 'eraser', key: 'E' },
  { tool: 'fill', icon: 'fill', key: 'F' },
  { tool: 'picker', icon: 'picker', key: 'I' },
];

export type Shortcut =
  | { kind: 'tool'; tool: Tool }
  | { kind: 'undo' }
  | { kind: 'redo' }
  | { kind: 'color'; index: number }
  | { kind: 'cycle'; step: 1 | -1 };

export interface KeyInput {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
}

const TOOL_KEYS: Record<string, Tool> = { b: 'pencil', p: 'pencil', e: 'eraser', f: 'fill', g: 'fill', i: 'picker' };

export function shortcutFor(e: KeyInput): Shortcut | null {
  if (e.altKey) return null;
  const key = e.key.toLowerCase();
  if (e.ctrlKey || e.metaKey) {
    if (key === 'z') return e.shiftKey ? { kind: 'redo' } : { kind: 'undo' };
    if (key === 'y') return { kind: 'redo' };
    return null;
  }
  if (key in TOOL_KEYS) return { kind: 'tool', tool: TOOL_KEYS[key] };
  if (/^[1-9]$/.test(key)) return { kind: 'color', index: Number(key) - 1 };
  if (key === '[') return { kind: 'cycle', step: -1 };
  if (key === ']') return { kind: 'cycle', step: 1 };
  return null;
}

/** A modal is open: a native <dialog open> (our Modal) or an aria-modal overlay (e.g. a celebration). */
const OPEN_MODAL = 'dialog[open], [aria-modal="true"]';

/** Shortcuts must not fire while the user types in a form control or works in a dialog. */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  if (target.closest('dialog, [role="dialog"], [role="alertdialog"]')) return true;
  if (target instanceof HTMLElement && target.isContentEditable) return true;
  return ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);
}

/**
 * Whether a page-level keyboard shortcut must be ignored: the user is typing, or a modal dialog is open
 * (focus may then be on the dialog, on <body> or anywhere else, so the open modal itself is checked too).
 * Shared by the editor and the solve page.
 */
export function shouldIgnoreShortcut(e: Pick<Event, 'target'>, doc: Document = document): boolean {
  return isTypingTarget(e.target) || doc.querySelector(OPEN_MODAL) !== null;
}
