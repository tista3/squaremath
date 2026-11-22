// Canvas rendering of the visible part of the solve board (only cells inside the viewport are drawn).
import { textColorFor } from '../../core/colors';
import type { PictogramId } from '../../core/symbols';
import { getPictogram, PICTO_BOX, PICTO_STROKE, pictogramPath, SYMBOL_INK } from '../../render/pictograms';
import { labelLayout, splitLabel, type BoardLayout, type CellPos, type LabelLayout, type LabelMetrics } from './geometry';

const FONT_FAMILY = 'system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif';
const MEASURE_PX = 100;
/** Text smaller than this is noise; the child zooms in instead. */
const MIN_FONT_PX = 6;
/** Squares smaller than this show no pictogram. */
const MIN_PICTO_CELL_PX = 12;
const PICTO_FILL = 0.72;
const PICTO_LINE_MIN_PX = 1;
const PICTO_LINE_MAX_PX = 1.8;
/** Simple mode: a coloured square keeps just a trace of its symbol. */
const SYMBOL_DONE_ALPHA = 0.3;
const EMPTY_CELL = '#ffffff';
const INK = '#1e293b';
const GRID_LINE = '#94a3b8';
const BORDER = '#334155';
const WRONG = '#e11d48';
const CURSOR = '#ff8a00';

export interface BoardFrame {
  viewW: number;
  viewH: number;
  dpr: number;
  scrollX: number;
  scrollY: number;
  layout: BoardLayout;
  cellPx: number;
  cols: number;
  rows: number;
  labels: string[];
  /** Null in maths. In simple mode the picture per cell (null where the symbol is a label); symbols are drawn light. */
  pictograms: (PictogramId | null)[] | null;
  /** Hex per cell, null = not coloured. */
  fills: (string | null)[];
  wrong: boolean[] | null;
  /** Keyboard cursor cell, drawn as a focus ring; null when not navigating by keyboard. */
  cursor: CellPos | null;
}

/** Text measurements kept between frames: widths at MEASURE_PX, and the board metrics for `labels`. */
export interface TextCache {
  widths: Map<string, number>;
  labels: string[] | null;
  metrics: LabelMetrics | null;
}

export function createTextCache(): TextCache {
  return { widths: new Map(), labels: null, metrics: null };
}

const font = (px: number, weight = 600) => `${weight} ${px}px ${FONT_FAMILY}`;

function measure(ctx: CanvasRenderingContext2D, cache: TextCache, text: string): number {
  let w = cache.widths.get(text);
  if (w === undefined) {
    ctx.font = font(MEASURE_PX);
    w = Math.max(1, ctx.measureText(text).width);
    cache.widths.set(text, w);
  }
  return w;
}

/** Widest label on one line and widest stacked line, in em; recomputed only when the labels change. */
function boardMetrics(ctx: CanvasRenderingContext2D, cache: TextCache, labels: string[]): LabelMetrics {
  if (cache.labels === labels && cache.metrics) return cache.metrics;
  let single = 1;
  let stacked = 1;
  for (const label of labels) {
    single = Math.max(single, measure(ctx, cache, label));
    for (const part of splitLabel(label)) stacked = Math.max(stacked, measure(ctx, cache, part));
  }
  cache.labels = labels;
  cache.metrics = { single: single / MEASURE_PX, stacked: stacked / MEASURE_PX };
  return cache.metrics;
}

function visibleRange(scroll: number, view: number, origin: number, cellPx: number, count: number): [number, number] {
  const first = Math.max(0, Math.floor((scroll - origin) / cellPx));
  const last = Math.min(count, Math.ceil((scroll + view - origin) / cellPx));
  return [first, last];
}

export function drawBoard(canvas: HTMLCanvasElement, f: BoardFrame, cache: TextCache): void {
  const w = Math.max(1, Math.round(f.viewW * f.dpr));
  const h = Math.max(1, Math.round(f.viewH * f.dpr));
  if (canvas.width !== w) canvas.width = w;
  if (canvas.height !== h) canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  ctx.setTransform(f.dpr, 0, 0, f.dpr, 0, 0);
  ctx.clearRect(0, 0, f.viewW, f.viewH);
  ctx.translate(f.layout.ox - f.scrollX, f.layout.oy - f.scrollY);

  const [c0, c1] = visibleRange(f.scrollX, f.viewW, f.layout.ox, f.cellPx, f.cols);
  const [r0, r1] = visibleRange(f.scrollY, f.viewH, f.layout.oy, f.cellPx, f.rows);
  drawCells(ctx, f, c0, c1, r0, r1);
  drawGridLines(ctx, f, c0, c1, r0, r1);
  const text = labelLayout(boardMetrics(ctx, cache, f.labels), f.cellPx);
  if (text.fontPx >= MIN_FONT_PX) drawLabels(ctx, f, text, c0, c1, r0, r1);
  if (f.pictograms && f.cellPx >= MIN_PICTO_CELL_PX) drawPictograms(ctx, f, f.pictograms, c0, c1, r0, r1);
  if (f.wrong) drawWrongMarks(ctx, f, f.wrong, c0, c1, r0, r1);

  ctx.lineWidth = 2;
  ctx.strokeStyle = BORDER;
  ctx.strokeRect(0, 0, f.layout.gridW, f.layout.gridH);
  if (f.cursor) drawCursor(ctx, f.cursor, f.cellPx);
}

/** Keyboard focus ring around one cell: white halo + focus colour, readable on any fill. */
function drawCursor(ctx: CanvasRenderingContext2D, { c, r }: CellPos, px: number) {
  const width = Math.max(3, px * 0.08);
  ctx.lineJoin = 'round';
  ctx.lineWidth = width + 3;
  ctx.strokeStyle = '#ffffff';
  ctx.strokeRect(c * px + width / 2, r * px + width / 2, px - width, px - width);
  ctx.lineWidth = width;
  ctx.strokeStyle = CURSOR;
  ctx.strokeRect(c * px + width / 2, r * px + width / 2, px - width, px - width);
}

function drawCells(ctx: CanvasRenderingContext2D, f: BoardFrame, c0: number, c1: number, r0: number, r1: number) {
  const px = f.cellPx;
  for (let r = r0; r < r1; r++) {
    for (let c = c0; c < c1; c++) {
      ctx.fillStyle = f.fills[r * f.cols + c] ?? EMPTY_CELL;
      // Slight overlap avoids hairline seams between equal neighbours at fractional DPRs.
      ctx.fillRect(c * px, r * px, px + 0.5, px + 0.5);
    }
  }
}

function drawGridLines(ctx: CanvasRenderingContext2D, f: BoardFrame, c0: number, c1: number, r0: number, r1: number) {
  const px = f.cellPx;
  // Odd device-pixel line widths need a half-pixel offset to stay crisp.
  const off = Math.round(f.dpr) % 2 === 1 ? 0.5 / f.dpr : 0;
  ctx.beginPath();
  for (let c = c0; c <= c1; c++) {
    ctx.moveTo(c * px + off, r0 * px);
    ctx.lineTo(c * px + off, r1 * px);
  }
  for (let r = r0; r <= r1; r++) {
    ctx.moveTo(c0 * px, r * px + off);
    ctx.lineTo(c1 * px, r * px + off);
  }
  ctx.lineWidth = 1;
  ctx.strokeStyle = GRID_LINE;
  ctx.stroke();
}

function drawLabels(
  ctx: CanvasRenderingContext2D,
  f: BoardFrame,
  text: LabelLayout,
  c0: number,
  c1: number,
  r0: number,
  r1: number,
) {
  const px = f.cellPx;
  const size = text.fontPx;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const simple = f.pictograms !== null;
  // Simple mode: regular weight and grey, like the printed sheet.
  ctx.font = font(size, simple ? 400 : 600);
  const ink = simple ? SYMBOL_INK : INK;
  const doneAlpha = simple ? SYMBOL_DONE_ALPHA : 0.35;
  for (let r = r0; r < r1; r++) {
    for (let c = c0; c < c1; c++) {
      const i = r * f.cols + c;
      const fill = f.fills[i];
      // Coloured cells keep their sum faintly visible so it can be re-checked.
      ctx.globalAlpha = fill ? doneAlpha : 1;
      ctx.fillStyle = fill ? textColorFor(fill) : ink;
      const cx = c * px + px / 2;
      const cy = r * px + px / 2;
      const lines = text.stacked ? splitLabel(f.labels[i]) : [f.labels[i]];
      if (lines.length === 1) {
        ctx.fillText(lines[0], cx, cy);
      } else {
        ctx.fillText(lines[0], cx, cy - size * 0.56);
        ctx.fillText(lines[1], cx, cy + size * 0.56);
      }
    }
  }
  ctx.globalAlpha = 1;
}

const pictoPaths = new Map<PictogramId, { line: Path2D; dots: Path2D }>();

function pictoPath(id: PictogramId): { line: Path2D; dots: Path2D } {
  let paths = pictoPaths.get(id);
  if (!paths) {
    const { line, dots } = getPictogram(id);
    paths = { line: new Path2D(pictogramPath(line)), dots: new Path2D(pictogramPath(dots)) };
    pictoPaths.set(id, paths);
  }
  return paths;
}

function drawPictograms(
  ctx: CanvasRenderingContext2D,
  f: BoardFrame,
  pictograms: (PictogramId | null)[],
  c0: number,
  c1: number,
  r0: number,
  r1: number,
) {
  const px = f.cellPx;
  const scale = (px * PICTO_FILL) / PICTO_BOX;
  const inset = (px * (1 - PICTO_FILL)) / 2;
  // In canvas units, as the context is scaled while drawing.
  const lineWidth = Math.min(PICTO_LINE_MAX_PX, Math.max(PICTO_LINE_MIN_PX, PICTO_STROKE * scale)) / scale;
  for (let r = r0; r < r1; r++) {
    for (let c = c0; c < c1; c++) {
      const i = r * f.cols + c;
      const id = pictograms[i];
      if (!id) continue;
      const fill = f.fills[i];
      const ink = fill ? textColorFor(fill) : SYMBOL_INK;
      const paths = pictoPath(id);
      ctx.save();
      ctx.globalAlpha = fill ? SYMBOL_DONE_ALPHA : 1;
      ctx.translate(c * px + inset, r * px + inset);
      ctx.scale(scale, scale);
      ctx.lineWidth = lineWidth;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.strokeStyle = ink;
      ctx.fillStyle = ink;
      ctx.stroke(paths.line);
      ctx.fill(paths.dots);
      ctx.restore();
    }
  }
}

function drawWrongMarks(
  ctx: CanvasRenderingContext2D,
  f: BoardFrame,
  wrong: boolean[],
  c0: number,
  c1: number,
  r0: number,
  r1: number,
) {
  const px = f.cellPx;
  const inset = px * 0.2;
  const width = Math.max(2, px * 0.09);
  ctx.lineCap = 'round';
  ctx.beginPath();
  for (let r = r0; r < r1; r++) {
    for (let c = c0; c < c1; c++) {
      if (!wrong[r * f.cols + c]) continue;
      const x = c * px;
      const y = r * px;
      ctx.moveTo(x + inset, y + inset);
      ctx.lineTo(x + px - inset, y + px - inset);
      ctx.moveTo(x + px - inset, y + inset);
      ctx.lineTo(x + inset, y + px - inset);
    }
  }
  // White halo keeps the red cross visible on red or dark cells.
  ctx.lineWidth = width + 3;
  ctx.strokeStyle = '#ffffff';
  ctx.stroke();
  ctx.lineWidth = width;
  ctx.strokeStyle = WRONG;
  ctx.stroke();
}
