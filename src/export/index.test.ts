import { describe, expect, it } from 'vitest';
import type { Design } from '../core/types';
import { DEFAULT_PRINT, DEFAULT_PUZZLE } from '../core/types';
import { pictureCellPx, safeFileName, sheetPages, stackedWidthPx } from './index';

function makeDesign(size: number, overrides: Partial<Design> = {}): Design {
  return {
    id: 'd1',
    name: 'Test',
    width: size,
    height: size,
    palette: [
      { id: 'r', name: 'Red', hex: '#ff0000' },
      { id: 'w', name: 'White', hex: '#ffffff' },
    ],
    backgroundId: 'w',
    cells: Array.from({ length: size * size }, (_, i) => (i % 3 === 0 ? 'r' : 'w')),
    puzzle: { ...DEFAULT_PUZZLE },
    print: { ...DEFAULT_PRINT },
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  };
}

describe('safeFileName', () => {
  it.each([
    ['My cat', 'My cat'],
    ['Žlutý kůň', 'Žlutý kůň'],
    ['24x24 mix 1000/20 range sol', '24x24 mix 1000-20 range sol'],
    ['12:30 clock', '12-30 clock'],
    ['a/b\\c:d*e?f"g<h>i|j', 'a-b-c-d-e-f-g-h-i-j'],
    ['a//b', 'a-b'],
    ['/start and end?', 'start and end'],
    ['tab\there', 'tab here'],
    ['   ', 'squaremath'],
    ['...', 'squaremath'],
    ['???', 'squaremath'],
    ['x'.repeat(80), 'x'.repeat(50)],
  ])('%j → %j', (input, expected) => {
    expect(safeFileName(input)).toBe(expected);
  });
});

describe('sheetPages', () => {
  it('adds the solution page after the puzzle pages', () => {
    expect(sheetPages(makeDesign(8))).toHaveLength(1);
    expect(sheetPages(makeDesign(8, { print: { ...DEFAULT_PRINT, includeSolution: true } }))).toHaveLength(2);
  });

  it('includes every page of a split puzzle', () => {
    expect(sheetPages(makeDesign(40, { print: { ...DEFAULT_PRINT, includeSolution: true } })).length).toBeGreaterThan(2);
  });
});

describe('stackedWidthPx', () => {
  it('keeps the requested width while the image stays small', () => {
    expect(stackedWidthPx(1654, Math.SQRT2, 2)).toBe(1654);
  });

  it('shrinks many stacked pages to stay within mobile canvas limits', () => {
    const w = stackedWidthPx(1654, Math.SQRT2, 10);
    expect(w).toBeLessThan(1654);
    expect(w * w * (10 * Math.SQRT2 + 9 * 0.03)).toBeLessThanOrEqual(16_000_000);
  });
});

describe('pictureCellPx', () => {
  it('makes small pictures big enough to share and keeps at least 32 px per square', () => {
    expect(pictureCellPx({ width: 4, height: 4 })).toBe(300);
    expect(pictureCellPx({ width: 11, height: 8 }) * 11).toBeGreaterThanOrEqual(1200);
    expect(pictureCellPx({ width: 40, height: 40 })).toBe(32);
  });
});
