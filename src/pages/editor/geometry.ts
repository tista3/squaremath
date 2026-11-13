// Pure grid geometry for the editor: hit-testing, line rasterisation, painting and flood fill.
import { lineCells } from '../../core/grid';

export interface Cell {
  x: number;
  y: number;
}

/** Cell under a point given in CSS px relative to the canvas' top-left corner, or null when outside. */
export function cellAt(px: number, py: number, cssWidth: number, cssHeight: number, cols: number, rows: number): Cell | null {
  if (px < 0 || py < 0 || px >= cssWidth || py >= cssHeight) return null;
  return {
    x: Math.min(cols - 1, Math.floor((px * cols) / cssWidth)),
    y: Math.min(rows - 1, Math.floor((py * rows) / cssHeight)),
  };
}

/** Position and size of an element's content box (inside its border), in client px. */
export interface ContentBox {
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * Content box of an element: getBoundingClientRect() is the BORDER box, so the border (clientLeft/Top) is
 * skipped and clientWidth/Height used, otherwise taps near a cell edge land in the neighbouring cell.
 */
export function contentBoxOf(el: Pick<Element, 'getBoundingClientRect' | 'clientLeft' | 'clientTop' | 'clientWidth' | 'clientHeight'>): ContentBox {
  const r = el.getBoundingClientRect();
  return { left: r.left + el.clientLeft, top: r.top + el.clientTop, width: el.clientWidth, height: el.clientHeight };
}

/** Cell under a client (viewport) point, given the canvas' content box. */
export function cellAtClient(clientX: number, clientY: number, box: ContentBox, cols: number, rows: number): Cell | null {
  return cellAt(clientX - box.left, clientY - box.top, box.width, box.height, cols, rows);
}

const CURSOR_STEPS: Record<string, Cell> = {
  ArrowLeft: { x: -1, y: 0 },
  ArrowRight: { x: 1, y: 0 },
  ArrowUp: { x: 0, y: -1 },
  ArrowDown: { x: 0, y: 1 },
};

/** Keyboard cursor after an arrow key (clamped to the grid), or null when `key` is not an arrow key. */
export function moveCursor(cell: Cell, key: string, cols: number, rows: number): Cell | null {
  const step = CURSOR_STEPS[key];
  if (!step) return null;
  return {
    x: Math.max(0, Math.min(cols - 1, cell.x + step.x)),
    y: Math.max(0, Math.min(rows - 1, cell.y + step.y)),
  };
}

/** Whole-px cell size that fits a cols×rows grid into the available box, clamped to [min, max]. */
export function fitCellSize(availWidth: number, availHeight: number, cols: number, rows: number, min = 4, max = 64): number {
  const fit = Math.floor(Math.min(availWidth / cols, availHeight / rows));
  return Math.max(min, Math.min(max, fit));
}

/** All cells on the line from `from` to `to` (both inclusive); the shared rasteriser in core/grid. */
export const bresenhamLine: (from: Cell, to: Cell) => Cell[] = lineCells;

/** Paint the given cells; returns the SAME array when nothing changed (cheap change detection). */
export function paintCells(cells: string[], points: Cell[], width: number, colorId: string): string[] {
  let out = cells;
  for (const { x, y } of points) {
    const i = y * width + x;
    if (out[i] === colorId) continue;
    if (out === cells) out = cells.slice();
    out[i] = colorId;
  }
  return out;
}

/** 4-neighbour flood fill from `start`; returns the SAME array when nothing changes. */
export function floodFill(cells: string[], width: number, height: number, start: Cell, colorId: string): string[] {
  const target = cells[start.y * width + start.x];
  if (target === undefined || target === colorId) return cells;
  const out = cells.slice();
  const stack = [start.y * width + start.x];
  while (stack.length > 0) {
    const i = stack.pop()!;
    if (out[i] !== target) continue;
    out[i] = colorId;
    const x = i % width;
    if (x > 0) stack.push(i - 1);
    if (x < width - 1) stack.push(i + 1);
    if (i >= width) stack.push(i - width);
    if (i < width * (height - 1)) stack.push(i + width);
  }
  return out;
}
