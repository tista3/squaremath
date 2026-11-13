// Undo/redo for editor edits. Every picture edit goes through commit() so it becomes one undo step.
import { useState } from 'react';
import type { Design } from '../../core/types';
import { EMPTY_HISTORY, recordEdit, redoEdit, sameSnapshot, snapshotOf, undoEdit, type History, type HistoryStep, type Snapshot } from './history';

export interface EditHistory {
  /** Apply a new picture state (extra Design fields are ignored) as one undo step; no-op if unchanged. */
  commit(next: Snapshot): void;
  undo(): void;
  redo(): void;
  canUndo: boolean;
  canRedo: boolean;
}

export function useEditHistory(design: Design, onChange: (updater: (d: Design) => Design) => void): EditHistory {
  const [history, setHistory] = useState<History>(EMPTY_HISTORY);
  const current = snapshotOf(design);

  // Merge only the snapshot fields so concurrent changes elsewhere (name, puzzle settings) survive.
  const apply = (s: Snapshot) => {
    const fields = snapshotOf(s);
    onChange((d) => ({ ...d, ...fields }));
  };

  const step = (fn: (h: History, cur: Snapshot) => HistoryStep | null) => {
    const result = fn(history, current);
    if (!result) return;
    setHistory(result.history);
    apply(result.snapshot);
  };

  return {
    commit(next) {
      if (sameSnapshot(current, next)) return;
      setHistory((h) => recordEdit(h, current));
      apply(next);
    },
    undo: () => step(undoEdit),
    redo: () => step(redoEdit),
    canUndo: history.past.length > 0,
    canRedo: history.future.length > 0,
  };
}
