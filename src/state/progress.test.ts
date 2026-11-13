import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_PRINT, DEFAULT_PUZZLE, type Design } from '../core/types';
import {
  MAX_PROGRESS_ENTRIES,
  PROGRESS_STORAGE_KEY,
  clearProgress,
  decodeCells,
  encodeCells,
  fnv1a,
  loadProgress,
  progressKey,
  saveProgress,
} from './progress';

function design(overrides: Partial<Design> = {}): Design {
  return {
    id: 'd1',
    name: 'Heart',
    width: 2,
    height: 2,
    palette: [
      { id: 'w', name: 'White', hex: '#ffffff' },
      { id: 'r', name: 'Red', hex: '#ff0000' },
    ],
    backgroundId: 'w',
    cells: ['w', 'r', 'r', 'w'],
    puzzle: { ...DEFAULT_PUZZLE },
    print: { ...DEFAULT_PRINT },
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe('fnv1a', () => {
  it('matches the reference value and differs per basis', () => {
    expect(fnv1a('')).toBe('811c9dc5');
    expect(fnv1a('a')).toBe('e40c292c');
    expect(fnv1a('a', 1)).not.toBe(fnv1a('a'));
  });
});

describe('progressKey', () => {
  it('is stable for identical content', () => {
    expect(progressKey(design())).toBe(progressKey(design({ name: 'Other', updatedAt: 99 })));
  });

  it('changes when the puzzle would change', () => {
    const base = progressKey(design());
    expect(progressKey(design({ id: 'd2' }))).not.toBe(base);
    expect(progressKey(design({ cells: ['r', 'r', 'r', 'w'] }))).not.toBe(base);
    expect(progressKey(design({ puzzle: { ...DEFAULT_PUZZLE, seed: 2 } }))).not.toBe(base);
    expect(progressKey(design({ puzzle: { ...DEFAULT_PUZZLE, legendMode: 'value' } }))).not.toBe(base);
    expect(progressKey(design({ width: 4, height: 1 }))).not.toBe(base);
  });

  it('ignores print settings', () => {
    expect(progressKey(design({ print: { ...DEFAULT_PRINT, divSymbol: ':' } }))).toBe(progressKey(design()));
  });
});

describe('cell packing', () => {
  it('round-trips ids and empty cells', () => {
    const cells = ['a', null, 'b', 'a', null, 'long-id-123'];
    const { ids, d } = encodeCells(cells);
    expect(ids).toEqual(['a', 'b', 'long-id-123']);
    expect(d).toHaveLength(cells.length);
    expect(decodeCells(ids, d)).toEqual(cells);
  });

  it('decodes unknown indexes as empty', () => {
    expect(decodeCells(['a'], '0z-')).toEqual(['a', null, null]);
  });
});

describe('load / save / clear', () => {
  it('returns null when nothing is saved', () => {
    expect(loadProgress('missing')).toBeNull();
  });

  it('saves, loads and clears', () => {
    saveProgress('k', ['r', null, 'w', null]);
    expect(loadProgress('k')).toEqual(['r', null, 'w', null]);
    clearProgress('k');
    expect(loadProgress('k')).toBeNull();
  });

  it('keeps only the most recent entries', () => {
    let now = 1000;
    vi.spyOn(Date, 'now').mockImplementation(() => now++);
    for (let i = 0; i < MAX_PROGRESS_ENTRIES + 5; i++) saveProgress(`k${i}`, ['r']);
    const map = JSON.parse(localStorage.getItem(PROGRESS_STORAGE_KEY)!);
    expect(Object.keys(map)).toHaveLength(MAX_PROGRESS_ENTRIES);
    expect(loadProgress('k0')).toBeNull();
    expect(loadProgress(`k${MAX_PROGRESS_ENTRIES + 4}`)).toEqual(['r']);
  });

  it('survives corrupt storage and failing storage', () => {
    localStorage.setItem(PROGRESS_STORAGE_KEY, '{not json');
    expect(loadProgress('k')).toBeNull();
    localStorage.setItem(PROGRESS_STORAGE_KEY, JSON.stringify({ k: { ids: 5, d: 1 } }));
    expect(loadProgress('k')).toBeNull();

    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota');
    });
    expect(() => saveProgress('k', ['r'])).not.toThrow();
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied');
    });
    expect(loadProgress('k')).toBeNull();
    expect(() => clearProgress('k')).not.toThrow();
  });
});
