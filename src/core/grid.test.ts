import { describe, expect, it } from 'vitest';
import { clampGridSize, GRID_SIZE_PRESETS, lineCells } from './grid';
import { GRID_MAX, GRID_MIN } from './types';

describe('lineCells', () => {
  it('covers both ends without gaps', () => {
    expect(lineCells({ x: 2, y: 3 }, { x: 2, y: 3 })).toEqual([{ x: 2, y: 3 }]);
    const line = lineCells({ x: 0, y: 0 }, { x: 2, y: 7 });
    expect(line[0]).toEqual({ x: 0, y: 0 });
    expect(line.at(-1)).toEqual({ x: 2, y: 7 });
    for (let i = 1; i < line.length; i++) {
      expect(Math.max(Math.abs(line[i].x - line[i - 1].x), Math.abs(line[i].y - line[i - 1].y))).toBe(1);
    }
  });
});

describe('clampGridSize', () => {
  it('rounds, clamps and falls back', () => {
    expect(clampGridSize('12.4', 16)).toBe(12);
    expect(clampGridSize('1', 16)).toBe(GRID_MIN);
    expect(clampGridSize(999, 16)).toBe(GRID_MAX);
    expect(clampGridSize('', 16)).toBe(16);
    expect(clampGridSize('abc', 10)).toBe(10);
  });
  it('presets are valid sizes', () => {
    for (const n of GRID_SIZE_PRESETS) expect(clampGridSize(n, 0)).toBe(n);
  });
});
