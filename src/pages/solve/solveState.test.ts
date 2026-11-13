import { describe, expect, it } from 'vitest';
import {
  UNDO_LIMIT,
  countFilled,
  countTargets,
  emptyFills,
  initialSolveState,
  isSolved,
  sanitizeProgress,
  solveReducer,
  wrongMask,
  type SolveAction,
  type SolveState,
} from './solveState';

const run = (state: SolveState, ...actions: SolveAction[]) => actions.reduce(solveReducer, state);
const start = () => initialSolveState(emptyFills(4));

describe('solveReducer', () => {
  it('records one undo step per stroke', () => {
    const s = run(
      start(),
      { type: 'strokeStart' },
      { type: 'paint', cells: [0], value: 'r' },
      { type: 'paint', cells: [1, 2], value: 'r' },
      { type: 'strokeEnd' },
    );
    expect(s.filled).toEqual(['r', 'r', 'r', null]);
    expect(s.undo).toHaveLength(1);
    expect(run(s, { type: 'undo' }).filled).toEqual(emptyFills(4));
  });

  it('does not record strokes that change nothing', () => {
    const s = run(start(), { type: 'strokeStart' }, { type: 'paint', cells: [0], value: null }, { type: 'strokeEnd' });
    expect(s.undo).toHaveLength(0);
    expect(s.strokeBase).toBeNull();
  });

  it('cancels a stroke back to its start', () => {
    const s = run(start(), { type: 'strokeStart' }, { type: 'paint', cells: [3], value: 'b' }, { type: 'strokeCancel' });
    expect(s.filled).toEqual(emptyFills(4));
    expect(s.undo).toHaveLength(0);
  });

  it('ignores out-of-range cells', () => {
    const s = start();
    expect(run(s, { type: 'paint', cells: [-1, 9], value: 'r' })).toBe(s);
  });

  it('erases with null', () => {
    const s = run(initialSolveState(['r', 'r', null, null]), { type: 'paint', cells: [0], value: null });
    expect(s.filled).toEqual([null, 'r', null, null]);
    expect(s.undo).toEqual([['r', 'r', null, null]]);
  });

  it('reset is undoable, restart is not', () => {
    const painted = initialSolveState(['r', 'b', null, null]);
    const reset = run(painted, { type: 'reset' });
    expect(reset.filled).toEqual(emptyFills(4));
    expect(run(reset, { type: 'undo' }).filled).toEqual(['r', 'b', null, null]);
    expect(run(painted, { type: 'restart' })).toEqual(initialSolveState(emptyFills(4)));
  });

  it('caps the undo history', () => {
    let s = start();
    for (let i = 0; i < UNDO_LIMIT + 10; i++) s = run(s, { type: 'paint', cells: [i % 4], value: `c${i}` });
    expect(s.undo).toHaveLength(UNDO_LIMIT);
  });
});

describe('helpers', () => {
  const solution = ['r', 'r', 'b', 'w'];

  it('counts, checks and detects completion', () => {
    const filled = ['r', 'b', null, 'w'];
    expect(countFilled(filled, solution)).toBe(3);
    expect(wrongMask(filled, solution)).toEqual([false, true, false, false]);
    expect(isSolved(filled, solution)).toBe(false);
    expect(isSolved([...solution], solution)).toBe(true);
  });

  it('skips cells with nothing to colour (blank paper background)', () => {
    const targets = ['r', null, 'b', null];
    expect(countTargets(targets)).toBe(2);
    expect(countFilled(['r', null, null, null], targets)).toBe(1);
    expect(isSolved(['r', null, 'b', null], targets)).toBe(true);
    // Colouring a blank paper cell is a mistake, and the picture is not finished then.
    expect(wrongMask(['r', 'r', 'b', null], targets)).toEqual([false, true, false, false]);
    expect(isSolved(['r', 'r', 'b', null], targets)).toBe(false);
  });

  it('sanitizes saved progress', () => {
    const allowed = new Set(['r', 'b']);
    expect(sanitizeProgress(['r', 'x', null, 'b'], 4, allowed)).toEqual(['r', null, null, 'b']);
    expect(sanitizeProgress(['r'], 4, allowed)).toEqual(emptyFills(4));
    expect(sanitizeProgress(null, 2, allowed)).toEqual([null, null]);
  });
});
