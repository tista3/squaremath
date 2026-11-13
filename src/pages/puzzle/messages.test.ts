import { describe, expect, it } from 'vitest';
import { PuzzleGenerationError } from '../../export';
import { t } from '../../i18n';
import { exportErrorMessage, isPopupBlocked, puzzleErrorMessage } from './messages';

describe('exportErrorMessage', () => {
  it('tells the user to allow pop-ups when printing is blocked', () => {
    expect(exportErrorMessage(new Error('Popup blocked: allow popups to print'))).toBe(t('puzzle.popupBlocked'));
    const typed = Object.assign(new Error('blocked'), { name: 'PopupBlockedError' });
    expect(isPopupBlocked(typed)).toBe(true);
    expect(isPopupBlocked(Object.assign(new Error('x'), { code: 'popupBlocked' }))).toBe(true);
  });

  it('explains puzzle generation errors', () => {
    const err = new PuzzleGenerationError({ code: 'tooManyColors', colorsUsed: 9, resultsAvailable: 4 });
    expect(exportErrorMessage(err)).toBe(t('puzzle.tooManyColors', { used: 9, available: 4 }));
    expect(puzzleErrorMessage({ code: 'noOps' })).toBe(t('puzzle.noOps'));
    expect(puzzleErrorMessage({ code: 'unexpected' })).toBe(t('puzzle.unexpectedError'));
  });

  it('falls back to the generic message', () => {
    expect(exportErrorMessage(new Error('disk full'))).toBe(t('puzzle.exportFailed'));
    expect(exportErrorMessage('nope')).toBe(t('puzzle.exportFailed'));
  });
});
