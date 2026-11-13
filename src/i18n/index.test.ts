import { describe, expect, it } from 'vitest';
import { t } from '.';

describe('t', () => {
  it('substitutes placeholders', () => {
    expect(t('common.shareTitle', { name: 'Heart' })).toBe('Share “Heart”');
  });

  it('returns the key for a missing entry', () => {
    expect(t('common.noSuchKey')).toBe('common.noSuchKey');
  });

  it('picks the plural form from params.count', () => {
    expect(t('gallery.importAdded', { count: 1 })).toBe('1 design added');
    expect(t('gallery.importAdded', { count: 0 })).toBe('0 designs added');
    expect(t('gallery.importAdded', { count: 5 })).toBe('5 designs added');
  });

  it('uses the plain key when there are no plural variants', () => {
    expect(t('shared.colours', { count: 1 })).toBe('Colours (1)');
  });
});
