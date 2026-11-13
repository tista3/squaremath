import { useMemo } from 'react';
import { generatePuzzle } from '../../core/puzzle';
import type { Design, PuzzleError, PuzzleResult } from '../../core/types';

/** generatePuzzle result, plus an 'unexpected' error when generation throws. */
export type PuzzleOutcome =
  | Extract<PuzzleResult, { ok: true }>
  | { ok: false; error: PuzzleError | { code: 'unexpected' } };

export function safeGeneratePuzzle(design: Design): PuzzleOutcome {
  try {
    return generatePuzzle(design);
  } catch (err) {
    console.error('generatePuzzle failed', err);
    return { ok: false, error: { code: 'unexpected' } };
  }
}

/** Memoised on exactly the inputs the puzzle depends on, so print/name edits don't regenerate it. */
export function usePuzzleResult(design: Design): PuzzleOutcome {
  const { width, height, cells, palette, backgroundId, puzzle } = design;
  return useMemo(
    () => safeGeneratePuzzle(design),
    // `design` is intentionally not a dependency; only these fields influence generation.
    [width, height, cells, palette, backgroundId, puzzle],
  );
}
