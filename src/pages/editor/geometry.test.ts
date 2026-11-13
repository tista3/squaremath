import { describe, expect, it } from 'vitest';
import { bresenhamLine, cellAt, cellAtClient, contentBoxOf, fitCellSize, floodFill, moveCursor, paintCells } from './geometry';

describe('cellAt', () => {
  it('maps CSS px to cells', () => {
    expect(cellAt(0, 0, 100, 50, 10, 5)).toEqual({ x: 0, y: 0 });
    expect(cellAt(99.9, 49.9, 100, 50, 10, 5)).toEqual({ x: 9, y: 4 });
    expect(cellAt(25, 12, 100, 50, 10, 5)).toEqual({ x: 2, y: 1 });
  });
  it('returns null outside', () => {
    expect(cellAt(-1, 0, 100, 50, 10, 5)).toBeNull();
    expect(cellAt(100, 0, 100, 50, 10, 5)).toBeNull();
    expect(cellAt(0, 50, 100, 50, 10, 5)).toBeNull();
  });
});

describe('cellAtClient / contentBoxOf', () => {
  // 16 cols × 20px with a 2px border: border box 324 wide at client x=100.
  const el = {
    getBoundingClientRect: () => ({ left: 100, top: 50, width: 324, height: 324 }) as DOMRect,
    clientLeft: 2,
    clientTop: 2,
    clientWidth: 320,
    clientHeight: 320,
  };
  const box = contentBoxOf(el);
  it('skips the border', () => {
    expect(box).toEqual({ left: 102, top: 52, width: 320, height: 320 });
  });
  it('maps the last pixel of a cell to that cell, not its neighbour', () => {
    expect(cellAtClient(102 + 19.5, 52 + 19.5, box, 16, 16)).toEqual({ x: 0, y: 0 });
    expect(cellAtClient(102 + 20, 52, box, 16, 16)).toEqual({ x: 1, y: 0 });
    expect(cellAtClient(102 + 300.5, 52, box, 16, 16)).toEqual({ x: 15, y: 0 });
  });
  it('treats the border itself as outside the grid', () => {
    expect(cellAtClient(101, 60, box, 16, 16)).toBeNull();
    expect(cellAtClient(102 + 320.5, 60, box, 16, 16)).toBeNull();
  });
});

describe('moveCursor', () => {
  it('moves with arrow keys and clamps to the grid', () => {
    expect(moveCursor({ x: 1, y: 1 }, 'ArrowRight', 4, 3)).toEqual({ x: 2, y: 1 });
    expect(moveCursor({ x: 1, y: 1 }, 'ArrowUp', 4, 3)).toEqual({ x: 1, y: 0 });
    expect(moveCursor({ x: 0, y: 0 }, 'ArrowLeft', 4, 3)).toEqual({ x: 0, y: 0 });
    expect(moveCursor({ x: 3, y: 2 }, 'ArrowDown', 4, 3)).toEqual({ x: 3, y: 2 });
  });
  it('ignores other keys', () => {
    expect(moveCursor({ x: 0, y: 0 }, 'a', 4, 3)).toBeNull();
  });
});

describe('fitCellSize', () => {
  it('fits the limiting dimension and clamps', () => {
    expect(fitCellSize(320, 1000, 16, 16)).toBe(20);
    expect(fitCellSize(1000, 300, 10, 20)).toBe(15);
    expect(fitCellSize(100, 100, 40, 40)).toBe(4);
    expect(fitCellSize(2000, 2000, 4, 4)).toBe(64);
  });
});

describe('bresenhamLine', () => {
  it('single point', () => {
    expect(bresenhamLine({ x: 2, y: 3 }, { x: 2, y: 3 })).toEqual([{ x: 2, y: 3 }]);
  });
  it('horizontal, vertical and diagonal lines are contiguous and inclusive', () => {
    expect(bresenhamLine({ x: 0, y: 0 }, { x: 3, y: 0 })).toHaveLength(4);
    expect(bresenhamLine({ x: 1, y: 4 }, { x: 1, y: 0 })).toHaveLength(5);
    expect(bresenhamLine({ x: 0, y: 0 }, { x: 3, y: 3 })).toEqual([
      { x: 0, y: 0 },
      { x: 1, y: 1 },
      { x: 2, y: 2 },
      { x: 3, y: 3 },
    ]);
  });
  it('never skips cells on steep lines', () => {
    const line = bresenhamLine({ x: 0, y: 0 }, { x: 2, y: 7 });
    expect(line[0]).toEqual({ x: 0, y: 0 });
    expect(line[line.length - 1]).toEqual({ x: 2, y: 7 });
    for (let i = 1; i < line.length; i++) {
      expect(Math.abs(line[i].x - line[i - 1].x)).toBeLessThanOrEqual(1);
      expect(Math.abs(line[i].y - line[i - 1].y)).toBe(1);
    }
  });
});

describe('paintCells', () => {
  it('returns same array when unchanged', () => {
    const cells = ['a', 'a', 'a', 'a'];
    expect(paintCells(cells, [{ x: 0, y: 0 }], 2, 'a')).toBe(cells);
  });
  it('paints immutably', () => {
    const cells = ['a', 'a', 'a', 'a'];
    const out = paintCells(cells, [{ x: 1, y: 1 }, { x: 0, y: 1 }], 2, 'b');
    expect(out).toEqual(['a', 'a', 'b', 'b']);
    expect(cells).toEqual(['a', 'a', 'a', 'a']);
  });
});

describe('floodFill', () => {
  // 4x3:
  // a a b a
  // a b b a
  // b a a a
  const grid = ['a', 'a', 'b', 'a', 'a', 'b', 'b', 'a', 'b', 'a', 'a', 'a'];
  it('fills the 4-connected region only', () => {
    expect(floodFill(grid, 4, 3, { x: 0, y: 0 }, 'c')).toEqual(['c', 'c', 'b', 'a', 'c', 'b', 'b', 'a', 'b', 'a', 'a', 'a']);
  });
  it('does not cross diagonals and wraps no rows', () => {
    expect(floodFill(grid, 4, 3, { x: 3, y: 0 }, 'c')).toEqual(['a', 'a', 'b', 'c', 'a', 'b', 'b', 'c', 'b', 'c', 'c', 'c']);
  });
  it('is a no-op when colour matches', () => {
    expect(floodFill(grid, 4, 3, { x: 2, y: 0 }, 'b')).toBe(grid);
  });
});
