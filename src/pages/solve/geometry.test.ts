import { describe, expect, it } from 'vitest';
import {
  BLOCK_LABEL_GAIN,
  BOARD_PAD,
  LABEL_FILL,
  MAX_CELL_PX,
  MIN_CELL_PX,
  READABLE_CELL_PX,
  ZOOM_GUTTER,
  boardLayout,
  cellAtPoint,
  cellIndexes,
  fitCellPx,
  initialCellPx,
  labelLayout,
  labelLayoutBox,
  lineCells,
  moveCursor,
  revealScroll,
  splitLabel,
  zoomInsets,
} from './geometry';

describe('boardLayout', () => {
  it('centres a small grid in the viewport', () => {
    const l = boardLayout(500, 300, 10, 5, 20);
    expect(l).toMatchObject({ gridW: 200, gridH: 100, contentW: 500, contentH: 300, ox: 150, oy: 100 });
  });

  it('grows the content (with padding) for a big grid', () => {
    const l = boardLayout(300, 300, 40, 40, 30);
    expect(l.contentW).toBe(1200 + 2 * BOARD_PAD);
    expect(l.ox).toBe(BOARD_PAD);
  });
});

describe('zoom button strip', () => {
  it('docks on the longer side', () => {
    expect(zoomInsets(800, 500)).toEqual({ right: ZOOM_GUTTER, bottom: 0 });
    expect(zoomInsets(380, 600)).toEqual({ right: 0, bottom: ZOOM_GUTTER });
  });

  it('centres a small grid beside the strip, never under it', () => {
    const insets = zoomInsets(500, 300);
    const l = boardLayout(500, 300, 10, 5, 20, insets);
    expect(l.contentW).toBe(500);
    expect(l.ox + l.gridW).toBeLessThanOrEqual(500 - ZOOM_GUTTER);
    expect(l.ox).toBe((500 - ZOOM_GUTTER - 200) / 2);
  });

  it('lets every cell of a big grid scroll clear of the strip', () => {
    for (const [w, h] of [
      [1068, 766],
      [374, 450],
    ]) {
      const insets = zoomInsets(w, h);
      const l = boardLayout(w, h, 20, 20, 52, insets);
      // Scrolled to the end, the last column / row ends before the strip.
      const maxScrollX = l.contentW - w;
      const maxScrollY = l.contentH - h;
      expect(l.ox + l.gridW - maxScrollX).toBeLessThanOrEqual(w - insets.right);
      expect(l.oy + l.gridH - maxScrollY).toBeLessThanOrEqual(h - insets.bottom);
    }
  });

  it('fits the whole grid outside the strip', () => {
    const insets = zoomInsets(1068, 766);
    const px = fitCellPx(1068, 766, 20, 12, insets);
    const l = boardLayout(1068, 766, 20, 12, px, insets);
    expect(l.contentW).toBe(1068);
    expect(l.contentH).toBe(766);
    expect(l.ox + l.gridW).toBeLessThanOrEqual(1068 - insets.right);
    expect(initialCellPx(1068, 766, 20, 12, insets)).toBe(px);
  });
});

describe('zoom levels', () => {
  it('fits the whole grid within limits', () => {
    expect(fitCellPx(424, 224, 10, 5)).toBe(40);
    expect(fitCellPx(100, 100, 40, 40)).toBe(MIN_CELL_PX);
    expect(fitCellPx(5000, 5000, 4, 4)).toBe(MAX_CELL_PX);
  });

  it('starts readable even when the fit is tiny', () => {
    expect(initialCellPx(360, 500, 40, 40)).toBe(READABLE_CELL_PX);
    expect(initialCellPx(1000, 1000, 10, 10)).toBe(97);
  });
});

describe('cells', () => {
  it('maps points to cells, including outside the grid', () => {
    expect(cellAtPoint(45, 10, 20)).toEqual({ c: 2, r: 0 });
    expect(cellAtPoint(-1, -1, 20)).toEqual({ c: -1, r: -1 });
  });

  it('draws gap-free lines', () => {
    expect(lineCells({ c: 0, r: 0 }, { c: 3, r: 0 })).toHaveLength(4);
    expect(lineCells({ c: 2, r: 2 }, { c: 2, r: 2 })).toEqual([{ c: 2, r: 2 }]);
    const diag = lineCells({ c: 0, r: 0 }, { c: 3, r: 1 });
    expect(diag[0]).toEqual({ c: 0, r: 0 });
    expect(diag[diag.length - 1]).toEqual({ c: 3, r: 1 });
    expect(lineCells({ c: 3, r: 3 }, { c: 0, r: 0 })).toHaveLength(4);
  });

  it('keeps only indexes inside the grid', () => {
    const cells = [
      { c: -1, r: 0 },
      { c: 1, r: 1 },
      { c: 4, r: 0 },
    ];
    expect(cellIndexes(cells, 4, 2)).toEqual([5]);
  });
});

describe('keyboard cursor', () => {
  it('moves and stays inside the grid', () => {
    expect(moveCursor({ c: 1, r: 1 }, 'ArrowRight', 4, 3)).toEqual({ c: 2, r: 1 });
    expect(moveCursor({ c: 0, r: 0 }, 'ArrowLeft', 4, 3)).toEqual({ c: 0, r: 0 });
    expect(moveCursor({ c: 1, r: 2 }, 'ArrowDown', 4, 3)).toEqual({ c: 1, r: 2 });
    expect(moveCursor({ c: 1, r: 1 }, 'End', 4, 3)).toEqual({ c: 3, r: 1 });
    expect(moveCursor({ c: 1, r: 1 }, 'PageUp', 4, 3)).toEqual({ c: 1, r: 0 });
    expect(moveCursor({ c: 1, r: 1 }, 'a', 4, 3)).toBeNull();
  });

  it('scrolls just enough to reveal a cell', () => {
    expect(revealScroll(100, 300, 150, 40)).toBe(100);
    expect(revealScroll(100, 300, 80, 40, 8)).toBe(72);
    expect(revealScroll(100, 300, 380, 40, 8)).toBe(128);
    expect(revealScroll(10, 300, 4, 40, 8)).toBe(0);
  });
});

describe('labelLayout', () => {
  it('uses one layout and one size for the whole board', () => {
    // Short sums ("9 − 2") fit on one line.
    expect(labelLayout({ single: 2.6, stacked: 1.6 }, 74)).toEqual({ stacked: false, fontPx: (74 * LABEL_FILL) / 2.6 });
    // A long sum somewhere ("10 − 10") stacks every label.
    const long = labelLayout({ single: 4.2, stacked: 1.8 }, 74);
    expect(long.stacked).toBe(true);
  });

  it('keeps text off the grid lines', () => {
    for (const m of [
      { single: 2, stacked: 1 },
      { single: 5, stacked: 2 },
      { single: 0.5, stacked: 0.5 },
    ]) {
      const l = labelLayout(m, 60);
      const widest = (l.stacked ? m.stacked : m.single) * l.fontPx;
      expect(widest).toBeLessThanOrEqual(60 * LABEL_FILL + 1e-9);
      expect(l.fontPx * (l.stacked ? 2.3 : 1)).toBeLessThanOrEqual(60 * LABEL_FILL + 1e-9);
    }
  });
});

describe('splitLabel', () => {
  it('stacks "a op b" on two lines', () => {
    expect(splitLabel('12 + 7')).toEqual(['12', '+ 7']);
    expect(splitLabel('42')).toEqual(['42']);
  });
});

describe('blocks', () => {
  it('stacks a three-number sum after its first step', () => {
    expect(splitLabel('12 + 7 − 5')).toEqual(['12 + 7', '− 5']);
  });

  it('lays out a single cell exactly like labelLayout, and lets a block grow only up to its cap', () => {
    const m = { single: 2.2, stacked: 1.2 };
    expect(labelLayoutBox(m, 40, 40)).toEqual(labelLayout(m, 40));
    const block = labelLayoutBox(m, 120, 120, BLOCK_LABEL_GAIN * 40 * 0.4);
    expect(block.fontPx).toBeGreaterThan(labelLayout(m, 40).fontPx);
    expect(block.fontPx).toBeLessThanOrEqual(BLOCK_LABEL_GAIN * 40 * 0.4);
  });
});
