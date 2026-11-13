// Pure layout maths for the scrollable, zoomable solve board.
import { lineCells as gridLine } from '../../core/grid';

/** Free space around the grid inside the scroll area (CSS px). */
export const BOARD_PAD = 12;
export const MIN_CELL_PX = 8;
export const MAX_CELL_PX = 120;
/** Starting zoom never goes below this, so expressions are readable without zooming in first. */
export const READABLE_CELL_PX = 30;

/** Width (or height) of the strip kept free for the zoom buttons: button 44 + 10px margin on each side. */
export const ZOOM_GUTTER = 64;

/** Space the floating zoom buttons take from the board's right or bottom edge. */
export interface Insets {
  right: number;
  bottom: number;
}

export const NO_INSETS: Insets = { right: 0, bottom: 0 };

/**
 * The zoom buttons dock along the board's longer side (a column on the right of a wide board, a row
 * along the bottom of a tall one), where reserving their strip costs the least cell size.
 */
export function zoomInsets(viewW: number, viewH: number): Insets {
  return viewW >= viewH ? { right: ZOOM_GUTTER, bottom: 0 } : { right: 0, bottom: ZOOM_GUTTER };
}

export interface BoardLayout {
  gridW: number;
  gridH: number;
  /** Scrollable content size: at least the viewport, so small grids are centred. */
  contentW: number;
  contentH: number;
  /** Grid origin in content coordinates. */
  ox: number;
  oy: number;
}

/**
 * Content size and grid origin. The insets strip is never under the grid: a small grid is centred in
 * the rest of the viewport, and a big one gets the strip as extra scroll room, so every cell can be
 * scrolled clear of the zoom buttons.
 */
export function boardLayout(
  viewW: number,
  viewH: number,
  cols: number,
  rows: number,
  cellPx: number,
  insets: Insets = NO_INSETS,
): BoardLayout {
  const gridW = cols * cellPx;
  const gridH = rows * cellPx;
  const contentW = Math.max(viewW, gridW + 2 * BOARD_PAD + insets.right);
  const contentH = Math.max(viewH, gridH + 2 * BOARD_PAD + insets.bottom);
  return {
    gridW,
    gridH,
    contentW,
    contentH,
    ox: Math.round((contentW - insets.right - gridW) / 2),
    oy: Math.round((contentH - insets.bottom - gridH) / 2),
  };
}

export function clampCellPx(px: number): number {
  return Math.min(MAX_CELL_PX, Math.max(MIN_CELL_PX, Math.round(px)));
}

/** Largest cell size that shows the whole grid outside the insets strip. */
export function fitCellPx(viewW: number, viewH: number, cols: number, rows: number, insets: Insets = NO_INSETS): number {
  const w = viewW - insets.right - 2 * BOARD_PAD;
  const h = viewH - insets.bottom - 2 * BOARD_PAD;
  return clampCellPx(Math.floor(Math.min(w / cols, h / rows)));
}

export function initialCellPx(viewW: number, viewH: number, cols: number, rows: number, insets: Insets = NO_INSETS): number {
  return Math.max(fitCellPx(viewW, viewH, cols, rows, insets), READABLE_CELL_PX);
}

/**
 * Scroll offset (one axis) that shows the span [start, start + size) inside a viewport of `view` px,
 * with `margin` px around it; unchanged when it is already visible.
 */
export function revealScroll(scroll: number, view: number, start: number, size: number, margin = 0): number {
  if (start - margin < scroll) return Math.max(0, start - margin);
  if (start + size + margin > scroll + view) return start + size + margin - view;
  return scroll;
}

export interface CellPos {
  c: number;
  r: number;
}

/** Cell under a point given relative to the grid origin; may lie outside the grid. */
export function cellAtPoint(x: number, y: number, cellPx: number): CellPos {
  return { c: Math.floor(x / cellPx), r: Math.floor(y / cellPx) };
}

/** All cells on the line from `from` to `to` (both inclusive); the shared rasteriser in core/grid. */
export function lineCells(from: CellPos, to: CellPos): CellPos[] {
  return gridLine({ x: from.c, y: from.r }, { x: to.c, y: to.r }).map(({ x, y }) => ({ c: x, r: y }));
}

/**
 * Keyboard cursor after a navigation key: arrows step one cell, Home/End jump to the row's ends,
 * PageUp/PageDown to the column's ends. Stays inside the grid; null for keys that do not navigate.
 */
export function moveCursor(at: CellPos, key: string, cols: number, rows: number): CellPos | null {
  const clamp = (c: number, r: number): CellPos => ({ c: Math.min(cols - 1, Math.max(0, c)), r: Math.min(rows - 1, Math.max(0, r)) });
  switch (key) {
    case 'ArrowLeft':
      return clamp(at.c - 1, at.r);
    case 'ArrowRight':
      return clamp(at.c + 1, at.r);
    case 'ArrowUp':
      return clamp(at.c, at.r - 1);
    case 'ArrowDown':
      return clamp(at.c, at.r + 1);
    case 'Home':
      return clamp(0, at.r);
    case 'End':
      return clamp(cols - 1, at.r);
    case 'PageUp':
      return clamp(at.c, 0);
    case 'PageDown':
      return clamp(at.c, rows - 1);
    default:
      return null;
  }
}

/** Row-major indexes of the positions that lie inside a cols×rows grid. */
export function cellIndexes(cells: CellPos[], cols: number, rows: number): number[] {
  return cells.filter(({ c, r }) => c >= 0 && r >= 0 && c < cols && r < rows).map(({ c, r }) => r * cols + c);
}

/** "12 + 7" -> ["12", "+ 7"] so a narrow cell can stack the expression on two lines. */
export function splitLabel(label: string): [string] | [string, string] {
  const parts = label.split(' ');
  return parts.length === 3 ? [parts[0], `${parts[1]} ${parts[2]}`] : [label];
}

/** Share of a cell's width (and height) labels may use; the rest keeps text off the grid lines. */
export const LABEL_FILL = 0.76;
/** Stacked labels must read clearly larger than single-line ones to be worth the extra line. */
const STACK_GAIN = 1.15;

/** Widest label of a board in em (text width at a 1px font): on one line, and as its widest stacked line. */
export interface LabelMetrics {
  single: number;
  stacked: number;
}

/** One text layout for every cell of the board, so neighbouring sums never differ in size or shape. */
export interface LabelLayout {
  stacked: boolean;
  fontPx: number;
}

export function labelLayout(m: LabelMetrics, cellPx: number): LabelLayout {
  const avail = cellPx * LABEL_FILL;
  const single = Math.min(avail / m.single, cellPx * 0.4);
  // Two lines at ±0.56em take about 2.2em of height.
  const stacked = Math.min(avail / m.stacked, avail / 2.3);
  return stacked > single * STACK_GAIN ? { stacked: true, fontPx: stacked } : { stacked: false, fontPx: single };
}
