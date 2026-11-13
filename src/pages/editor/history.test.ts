import { describe, expect, it } from 'vitest';
import { EMPTY_HISTORY, HISTORY_LIMIT, recordEdit, redoEdit, sameSnapshot, undoEdit, type Snapshot } from './history';

const snap = (cell: string): Snapshot => ({
  cells: [cell],
  palette: [{ id: cell, name: cell, hex: '#000000' }],
  backgroundId: cell,
  width: 1,
  height: 1,
});

describe('history', () => {
  it('undo then redo round-trips', () => {
    const h = recordEdit(EMPTY_HISTORY, snap('a'));
    const u = undoEdit(h, snap('b'))!;
    expect(u.snapshot).toEqual(snap('a'));
    expect(u.history.past).toHaveLength(0);
    const r = redoEdit(u.history, snap('a'))!;
    expect(r.snapshot).toEqual(snap('b'));
    expect(r.history.future).toHaveLength(0);
    expect(r.history.past).toEqual([snap('a')]);
  });
  it('returns null with nothing to undo/redo', () => {
    expect(undoEdit(EMPTY_HISTORY, snap('a'))).toBeNull();
    expect(redoEdit(EMPTY_HISTORY, snap('a'))).toBeNull();
  });
  it('a new edit clears redo', () => {
    const u = undoEdit(recordEdit(EMPTY_HISTORY, snap('a')), snap('b'))!;
    expect(recordEdit(u.history, snap('a')).future).toHaveLength(0);
  });
  it('caps the stack', () => {
    let h = EMPTY_HISTORY;
    for (let i = 0; i < HISTORY_LIMIT + 10; i++) h = recordEdit(h, snap(String(i)));
    expect(h.past).toHaveLength(HISTORY_LIMIT);
    expect(h.past[0]).toEqual(snap('10'));
  });
  it('compares snapshots by value', () => {
    expect(sameSnapshot(snap('a'), snap('a'))).toBe(true);
    expect(sameSnapshot(snap('a'), snap('b'))).toBe(false);
    expect(sameSnapshot(snap('a'), { ...snap('a'), palette: [{ id: 'a', name: 'x', hex: '#000000' }] })).toBe(false);
  });
});
