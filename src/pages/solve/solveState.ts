// Pure state for on-screen solving: which colour the child put into each cell, with stroke-based undo.
import type { PuzzleResult } from '../../core/types';

/** Colour id the child chose for a cell, null = not coloured yet. */
export type Fill = string | null;

export interface SolveState {
  filled: Fill[];
  /** Snapshots to go back to, oldest first. */
  undo: Fill[][];
  /** Snapshot taken at the start of the current drag; one stroke = one undo step. */
  strokeBase: Fill[] | null;
}

export type SolveAction =
  | { type: 'strokeStart' }
  | { type: 'paint'; cells: number[]; value: Fill }
  | { type: 'strokeEnd' }
  /** Second finger landed: the drag was a pinch/pan, so revert what it painted. */
  | { type: 'strokeCancel' }
  | { type: 'undo' }
  /** Clear everything (undoable). */
  | { type: 'reset' }
  /** Start over after finishing: clear everything including history. */
  | { type: 'restart' };

export const UNDO_LIMIT = 100;

export function emptyFills(size: number): Fill[] {
  return new Array<Fill>(size).fill(null);
}

export function initialSolveState(filled: Fill[]): SolveState {
  return { filled, undo: [], strokeBase: null };
}

/** Saved progress made safe for the current puzzle: right length, only colours from the legend. */
export function sanitizeProgress(saved: Fill[] | null, size: number, allowed: ReadonlySet<string>): Fill[] {
  if (!saved || saved.length !== size) return emptyFills(size);
  return saved.map((id) => (id !== null && allowed.has(id) ? id : null));
}

function pushUndo(undo: Fill[][], snapshot: Fill[]): Fill[][] {
  return [...undo.slice(-(UNDO_LIMIT - 1)), snapshot];
}

function paint(state: SolveState, cells: number[], value: Fill): SolveState {
  let next: Fill[] | null = null;
  for (const i of cells) {
    if (i < 0 || i >= state.filled.length || state.filled[i] === value) continue;
    next ??= state.filled.slice();
    next[i] = value;
  }
  if (!next) return state;
  if (state.strokeBase) return { ...state, filled: next };
  return { ...state, filled: next, undo: pushUndo(state.undo, state.filled) };
}

export function solveReducer(state: SolveState, action: SolveAction): SolveState {
  switch (action.type) {
    case 'strokeStart':
      return { ...state, strokeBase: state.filled };
    case 'paint':
      return paint(state, action.cells, action.value);
    case 'strokeEnd': {
      const base = state.strokeBase;
      if (!base) return state;
      // `paint` only allocates a new array on real changes, so identity tells whether the stroke did anything.
      const undo = base !== state.filled ? pushUndo(state.undo, base) : state.undo;
      return { ...state, undo, strokeBase: null };
    }
    case 'strokeCancel':
      return state.strokeBase ? { ...state, filled: state.strokeBase, strokeBase: null } : state;
    case 'undo':
      if (state.strokeBase || state.undo.length === 0) return state;
      return { ...state, filled: state.undo[state.undo.length - 1], undo: state.undo.slice(0, -1) };
    case 'reset':
      if (state.filled.every((f) => f === null)) return state;
      return { filled: emptyFills(state.filled.length), undo: pushUndo(state.undo, state.filled), strokeBase: null };
    case 'restart':
      return initialSolveState(emptyFills(state.filled.length));
  }
}

/**
 * Colour each cell must end up with; null = nothing to colour (a blank cell of a paper-white background,
 * see PuzzleSettings.blankBackground). Blank cells of a real background colour must be coloured too.
 */
export function solveTargets(cells: readonly string[], puzzle: Extract<PuzzleResult, { ok: true }>): (string | null)[] {
  const blankColors = new Set(puzzle.legend.filter((e) => e.blank).map((e) => e.colorId));
  return cells.map((id, i) => (puzzle.expressions[i] || blankColors.has(id) ? id : null));
}

/** Coloured cells among those that need colouring. */
export function countFilled(filled: Fill[], solution: readonly (string | null)[]): number {
  return filled.reduce((n, f, i) => (f === null || solution[i] === null ? n : n + 1), 0);
}

/** Number of cells the child has to colour. */
export function countTargets(solution: readonly (string | null)[]): number {
  return solution.reduce((n, s) => (s === null ? n : n + 1), 0);
}

/** true where a cell is coloured with the wrong colour. */
export function wrongMask(filled: Fill[], solution: readonly (string | null)[]): boolean[] {
  return filled.map((f, i) => f !== null && f !== solution[i]);
}

export function isSolved(filled: Fill[], solution: readonly (string | null)[]): boolean {
  return filled.length === solution.length && filled.every((f, i) => f === solution[i]);
}
