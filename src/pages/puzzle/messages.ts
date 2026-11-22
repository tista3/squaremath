// Translated messages for puzzle errors and failed exports (print / PDF / PNG).
import type { PuzzleError } from '../../core/types';
import { PuzzleGenerationError } from '../../export';
import { t } from '../../i18n';

/** Why a puzzle cannot be made, in the child's words. */
export function puzzleErrorMessage(error: PuzzleError | { code: 'unexpected' }): string {
  switch (error.code) {
    case 'tooManyColors':
      return t('puzzle.tooManyColors', { used: error.colorsUsed, available: error.resultsAvailable });
    case 'tooFewSymbols':
      return t('puzzle.tooFewSymbols', { used: error.colorsUsed, available: error.symbolsAvailable });
    case 'noOps':
      return t('puzzle.noOps');
    default:
      return t('puzzle.unexpectedError');
  }
}

/**
 * The browser refused to open the print window. Recognises a typed error (name 'PopupBlockedError'
 * or code 'popupBlocked') as well as the plain Error that export/index.ts throws today.
 */
export function isPopupBlocked(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const code = (err as { code?: unknown }).code;
  return err.name === 'PopupBlockedError' || code === 'popupBlocked' || /pop-?up/i.test(err.message);
}

/** Message for a failed print / download: a specific hint when there is one, else the generic one. */
export function exportErrorMessage(err: unknown): string {
  if (isPopupBlocked(err)) return t('puzzle.popupBlocked');
  if (err instanceof PuzzleGenerationError) return puzzleErrorMessage(err.error);
  return t('puzzle.exportFailed');
}
