// Pure undo/redo history of the picture-related parts of a design.
import type { Design } from '../../core/types';

export type Snapshot = Pick<Design, 'cells' | 'palette' | 'backgroundId' | 'width' | 'height'>;

export const HISTORY_LIMIT = 100;

export interface History {
  past: Snapshot[];
  future: Snapshot[];
}

export const EMPTY_HISTORY: History = { past: [], future: [] };

export function snapshotOf(d: Snapshot): Snapshot {
  return { cells: d.cells, palette: d.palette, backgroundId: d.backgroundId, width: d.width, height: d.height };
}

export function sameSnapshot(a: Snapshot, b: Snapshot): boolean {
  return (
    a.width === b.width &&
    a.height === b.height &&
    a.backgroundId === b.backgroundId &&
    samePalette(a.palette, b.palette) &&
    sameCells(a.cells, b.cells)
  );
}

function samePalette(a: Snapshot['palette'], b: Snapshot['palette']): boolean {
  if (a === b) return true;
  return a.length === b.length && a.every((c, i) => c.id === b[i].id && c.name === b[i].name && c.hex === b[i].hex);
}

function sameCells(a: string[], b: string[]): boolean {
  if (a === b) return true;
  return a.length === b.length && a.every((c, i) => c === b[i]);
}

/** Remember the state before an edit; clears the redo stack and caps the undo stack. */
export function recordEdit(h: History, before: Snapshot): History {
  return { past: [...h.past, before].slice(-HISTORY_LIMIT), future: [] };
}

export interface HistoryStep {
  history: History;
  /** The snapshot to apply to the design. */
  snapshot: Snapshot;
}

export function undoEdit(h: History, current: Snapshot): HistoryStep | null {
  if (h.past.length === 0) return null;
  return {
    snapshot: h.past[h.past.length - 1],
    history: { past: h.past.slice(0, -1), future: [...h.future, current].slice(-HISTORY_LIMIT) },
  };
}

export function redoEdit(h: History, current: Snapshot): HistoryStep | null {
  if (h.future.length === 0) return null;
  return {
    snapshot: h.future[h.future.length - 1],
    history: { past: [...h.past, current].slice(-HISTORY_LIMIT), future: h.future.slice(0, -1) },
  };
}
