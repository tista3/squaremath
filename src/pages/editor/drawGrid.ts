// Canvas rendering of the pixel grid (devicePixelRatio aware, crisp cell edges).
import type { Cell } from './geometry';

export interface GridPaint {
  cols: number;
  rows: number;
  cells: string[];
  /** palette id -> '#rrggbb' */
  colors: Map<string, string>;
  /** Cell size in CSS px (may be fractional). */
  cellPx: number;
  showGrid: boolean;
  /** Highlighted cell (mouse hover or keyboard cursor). */
  hover: Cell | null;
  /** window.devicePixelRatio at draw time (a prop, so a DPR change triggers a redraw). */
  dpr: number;
}

const FALLBACK_COLOR = '#ffffff';
const GRID_LINE = 'rgba(0, 0, 0, 0.22)';
const MIN_CELL_FOR_LINES = 6;

/** Device-pixel edges of `count` equal slices of `total` px, rounded so neighbours share exact edges. */
function edges(count: number, total: number): number[] {
  return Array.from({ length: count + 1 }, (_, i) => Math.round((i * total) / count));
}

export function drawGrid(canvas: HTMLCanvasElement, p: GridPaint): void {
  const dpr = p.dpr > 0 ? p.dpr : 1;
  const cssW = p.cols * p.cellPx;
  const cssH = p.rows * p.cellPx;
  const w = Math.max(1, Math.round(cssW * dpr));
  const h = Math.max(1, Math.round(cssH * dpr));
  if (canvas.width !== w) canvas.width = w;
  if (canvas.height !== h) canvas.height = h;
  canvas.style.width = `${cssW}px`;
  canvas.style.height = `${cssH}px`;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const xs = edges(p.cols, w);
  const ys = edges(p.rows, h);
  for (let y = 0; y < p.rows; y++) {
    for (let x = 0; x < p.cols; x++) {
      ctx.fillStyle = p.colors.get(p.cells[y * p.cols + x]) ?? FALLBACK_COLOR;
      ctx.fillRect(xs[x], ys[y], xs[x + 1] - xs[x], ys[y + 1] - ys[y]);
    }
  }

  const line = Math.max(1, Math.round(dpr));
  if (p.showGrid && p.cellPx >= MIN_CELL_FOR_LINES) {
    ctx.fillStyle = GRID_LINE;
    for (let x = 1; x < p.cols; x++) ctx.fillRect(xs[x], 0, line, h);
    for (let y = 1; y < p.rows; y++) ctx.fillRect(0, ys[y], w, line);
  }
  if (p.hover) drawHover(ctx, xs, ys, p.hover, line);
}

/** Double (dark + light) outline so the highlight is visible on any cell colour. */
function drawHover(ctx: CanvasRenderingContext2D, xs: number[], ys: number[], c: Cell, line: number): void {
  const x = xs[c.x];
  const y = ys[c.y];
  const w = xs[c.x + 1] - x;
  const h = ys[c.y + 1] - y;
  ctx.lineWidth = line * 2;
  ctx.strokeStyle = '#000000';
  ctx.strokeRect(x + line, y + line, w - 2 * line, h - 2 * line);
  ctx.lineWidth = line;
  ctx.strokeStyle = '#ffffff';
  ctx.strokeRect(x + 2.5 * line, y + 2.5 * line, w - 5 * line, h - 5 * line);
}
