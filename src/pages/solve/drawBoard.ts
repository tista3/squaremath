// Canvas rendering of the visible part of the solve board (only cells inside the viewport are drawn).
// With blocks, each block shows its label once in its middle, and the grid lines inside a block are faint.
import { textColorFor } from '../../core/colors';
import type { PictogramId } from '../../core/symbols';
import type { Block } from '../../core/types';
import { getPictogram, PICTO_BOX, PICTO_STROKE, pictogramPath, SYMBOL_INK } from '../../render/pictograms';
import {
  BLOCK_LABEL_GAIN,
  labelLayout,
  labelLayoutBox,
  splitLabel,
  type BoardLayout,
  type CellPos,
  type LabelLayout,
  type LabelMetrics,
} from './geometry';

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
/** Blocks: lines between the cells of a block, and along block edges. */
const INNER_LINE = '#dde3ea';
const BLOCK_LINE = '#64748b';
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
  /** Blocks of the puzzle and the block of each cell (−1 = none), or null without blocks. */
  blocks: { list: readonly Block[]; blockOf: Int32Array } | null;
}

/**
 * Text measurements kept between frames: widths at MEASURE_PX, the board metrics for `labels`, and with blocks
 * the metrics per block shape ("2x3"), so long sums in big blocks do not shrink the text of single cells.
 */
export interface TextCache {
  widths: Map<string, number>;
  labels: string[] | null;
  metrics: LabelMetrics | null;
  shapeBlocks: readonly Block[] | null;
  shapes: Map<string, LabelMetrics>;
}

export function createTextCache(): TextCache {
  return { widths: new Map(), labels: null, metrics: null, shapeBlocks: null, shapes: new Map() };
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
  cache.labels = labels;
  cache.metrics = labelMetrics(ctx, cache, labels);
  cache.shapeBlocks = null;
  return cache.metrics;
}

function labelMetrics(ctx: CanvasRenderingContext2D, cache: TextCache, labels: Iterable<string>): LabelMetrics {
  let single = 1;
  let stacked = 1;
  for (const label of labels) {
    single = Math.max(single, measure(ctx, cache, label));
    for (const part of splitLabel(label)) stacked = Math.max(stacked, measure(ctx, cache, part));
  }
  return { single: single / MEASURE_PX, stacked: stacked / MEASURE_PX };
}

/** Labels of two numbers ("12 + 7") or of one symbol: the ones that set the size of single cells. */
const SINGLE_KEY = 'single';

function isShortLabel(label: string): boolean {
  return label.split(' ').length <= 3;
}

/**
 * Metrics of the labels of each block shape ("2x3"), plus SINGLE_KEY for all short labels; recomputed only
 * when the labels or blocks change.
 */
function shapeMetrics(ctx: CanvasRenderingContext2D, cache: TextCache, labels: string[], blocks: readonly Block[], cols: number) {
  if (cache.labels === labels && cache.shapeBlocks === blocks) return cache.shapes;
  const all = blocks.map((b) => labels[b.y * cols + b.x]);
  const short = all.filter(isShortLabel);
  const byShape = new Map<string, string[]>([[SINGLE_KEY, short.length ? short : all]]);
  for (const b of blocks) {
    if (b.w * b.h === 1) continue;
    const key = `${b.w}x${b.h}`;
    const list = byShape.get(key);
    const label = labels[b.y * cols + b.x];
    if (list) list.push(label);
    else byShape.set(key, [label]);
  }
  cache.shapes = new Map([...byShape].map(([key, list]) => [key, labelMetrics(ctx, cache, list)]));
  cache.labels = labels;
  cache.metrics = null;
  cache.shapeBlocks = blocks;
  return cache.shapes;
}

/** Blocks overlapping the visible cells [c0, c1) × [r0, r1). */
function visibleBlocks(blocks: readonly Block[], c0: number, c1: number, r0: number, r1: number): Block[] {
  return blocks.filter((b) => b.x < c1 && b.x + b.w > c0 && b.y < r1 && b.y + b.h > r0);
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
  if (f.blocks) {
    drawBlockLines(ctx, f, f.blocks.blockOf, c0, c1, r0, r1);
    const shown = visibleBlocks(f.blocks.list, c0, c1, r0, r1);
    drawBlockLabels(ctx, f, shapeMetrics(ctx, cache, f.labels, f.blocks.list, f.cols), shown);
    if (f.pictograms && f.cellPx >= MIN_PICTO_CELL_PX) drawBlockPictograms(ctx, f, f.pictograms, shown);
  } else {
    drawGridLines(ctx, f, c0, c1, r0, r1);
    const text = labelLayout(boardMetrics(ctx, cache, f.labels), f.cellPx);
    if (text.fontPx >= MIN_FONT_PX) drawLabels(ctx, f, text, c0, c1, r0, r1);
    if (f.pictograms && f.cellPx >= MIN_PICTO_CELL_PX) drawPictograms(ctx, f, f.pictograms, c0, c1, r0, r1);
  }
  if (f.wrong) drawWrongMarks(ctx, f, f.wrong, c0, c1, r0, r1);

  ctx.lineWidth = 2;
  ctx.strokeStyle = BORDER;
  ctx.strokeRect(0, 0, f.layout.gridW, f.layout.gridH);
  if (f.cursor) drawCursor(ctx, cursorBox(f, f.cursor), f.cellPx);
}

/** The cells the cursor ring goes around: the cursor cell, or its whole block. */
function cursorBox(f: BoardFrame, at: CellPos): { c: number; r: number; w: number; h: number } {
  const k = f.blocks ? f.blocks.blockOf[at.r * f.cols + at.c] : -1;
  if (!f.blocks || k < 0) return { ...at, w: 1, h: 1 };
  const b = f.blocks.list[k];
  return { c: b.x, r: b.y, w: b.w, h: b.h };
}

/** Keyboard focus ring around a cell or block: white halo + focus colour, readable on any fill. */
function drawCursor(ctx: CanvasRenderingContext2D, { c, r, w, h }: { c: number; r: number; w: number; h: number }, px: number) {
  const width = Math.max(3, px * 0.08);
  ctx.lineJoin = 'round';
  ctx.lineWidth = width + 3;
  ctx.strokeStyle = '#ffffff';
  ctx.strokeRect(c * px + width / 2, r * px + width / 2, w * px - width, h * px - width);
  ctx.lineWidth = width;
  ctx.strokeStyle = CURSOR;
  ctx.strokeRect(c * px + width / 2, r * px + width / 2, w * px - width, h * px - width);
}

/** Grid lines with blocks: faint between the cells of a block, stronger along block edges and around blank cells. */
function drawBlockLines(
  ctx: CanvasRenderingContext2D,
  f: BoardFrame,
  blockOf: Int32Array,
  c0: number,
  c1: number,
  r0: number,
  r1: number,
) {
  const px = f.cellPx;
  const off = Math.round(f.dpr) % 2 === 1 ? 0.5 / f.dpr : 0;
  const inside = (i: number, j: number) => blockOf[i] >= 0 && blockOf[i] === blockOf[j];
  const inner = new Path2D();
  const edges = new Path2D();
  for (let c = c0; c <= c1; c++) {
    for (let r = r0; r < r1; r++) {
      const path = c > 0 && c < f.cols && inside(r * f.cols + c - 1, r * f.cols + c) ? inner : edges;
      path.moveTo(c * px + off, r * px);
      path.lineTo(c * px + off, (r + 1) * px);
    }
  }
  for (let r = r0; r <= r1; r++) {
    for (let c = c0; c < c1; c++) {
      const path = r > 0 && r < f.rows && inside((r - 1) * f.cols + c, r * f.cols + c) ? inner : edges;
      path.moveTo(c * px, r * px + off);
      path.lineTo((c + 1) * px, r * px + off);
    }
  }
  ctx.lineWidth = 1;
  ctx.strokeStyle = INNER_LINE;
  ctx.stroke(inner);
  ctx.lineWidth = px >= 24 ? 2 : 1;
  ctx.strokeStyle = BLOCK_LINE;
  ctx.stroke(edges);
}

/**
 * One label per block, centred. Single cells look as without blocks; bigger blocks grow their text up to
 * BLOCK_LABEL_GAIN × that size, and long sums shrink to fit their block.
 */
function drawBlockLabels(ctx: CanvasRenderingContext2D, f: BoardFrame, shapes: Map<string, LabelMetrics>, blocks: Block[]) {
  const px = f.cellPx;
  const singleMetrics = shapes.get(SINGLE_KEY);
  if (!singleMetrics) return;
  const single = labelLayout(singleMetrics, px);
  const cap = BLOCK_LABEL_GAIN * single.fontPx;
  const simple = f.pictograms !== null;
  const weight = simple ? 400 : 600;
  const ink = simple ? SYMBOL_INK : INK;
  const doneAlpha = simple ? SYMBOL_DONE_ALPHA : 0.35;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (const b of blocks) {
    const i = b.y * f.cols + b.x;
    const label = f.labels[i];
    if (!label) continue;
    const metrics = b.w * b.h === 1 ? null : shapes.get(`${b.w}x${b.h}`);
    const text = metrics ? labelLayoutBox(metrics, b.w * px, b.h * px, cap) : single;
    if (text.fontPx < MIN_FONT_PX) continue;
    const fill = f.fills[i];
    ctx.font = font(text.fontPx, weight);
    ctx.globalAlpha = fill ? doneAlpha : 1;
    ctx.fillStyle = fill ? textColorFor(fill) : ink;
    const cx = (b.x + b.w / 2) * px;
    const cy = (b.y + b.h / 2) * px;
    const lines = text.stacked ? splitLabel(label) : [label];
    if (lines.length === 1) {
      ctx.fillText(lines[0], cx, cy);
    } else {
      ctx.fillText(lines[0], cx, cy - text.fontPx * 0.56);
      ctx.fillText(lines[1], cx, cy + text.fontPx * 0.56);
    }
  }
  ctx.globalAlpha = 1;
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
  const inset = (px * (1 - PICTO_FILL)) / 2;
  for (let r = r0; r < r1; r++) {
    for (let c = c0; c < c1; c++) {
      const i = r * f.cols + c;
      const id = pictograms[i];
      if (id) drawPictogram(ctx, id, c * px + inset, r * px + inset, px * PICTO_FILL, f.fills[i]);
    }
  }
}

function drawBlockPictograms(ctx: CanvasRenderingContext2D, f: BoardFrame, pictograms: (PictogramId | null)[], blocks: Block[]) {
  const px = f.cellPx;
  for (const b of blocks) {
    const i = b.y * f.cols + b.x;
    const id = pictograms[i];
    if (!id) continue;
    const size = Math.min(b.w, b.h) * px * PICTO_FILL;
    const shown = b.w * b.h > 1 ? Math.min(size, BLOCK_LABEL_GAIN * px * PICTO_FILL) : size;
    drawPictogram(ctx, id, (b.x + b.w / 2) * px - shown / 2, (b.y + b.h / 2) * px - shown / 2, shown, f.fills[i]);
  }
}

/** One pictogram in a square of `size` px with its top-left corner at (x, y). */
function drawPictogram(ctx: CanvasRenderingContext2D, id: PictogramId, x: number, y: number, size: number, fill: string | null) {
  const scale = size / PICTO_BOX;
  // In canvas units, as the context is scaled while drawing.
  const lineWidth = Math.min(PICTO_LINE_MAX_PX, Math.max(PICTO_LINE_MIN_PX, PICTO_STROKE * scale)) / scale;
  const ink = fill ? textColorFor(fill) : SYMBOL_INK;
  const paths = pictoPath(id);
  ctx.save();
  ctx.globalAlpha = fill ? SYMBOL_DONE_ALPHA : 1;
  ctx.translate(x, y);
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

/** Red crosses on wrongly coloured cells; with blocks one cross over each block that has a wrong cell. */
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
  const cross = (x: number, y: number, w: number, h: number) => {
    ctx.moveTo(x + inset, y + inset);
    ctx.lineTo(x + w - inset, y + h - inset);
    ctx.moveTo(x + w - inset, y + inset);
    ctx.lineTo(x + inset, y + h - inset);
  };
  const marked = new Set<number>();
  ctx.lineCap = 'round';
  ctx.beginPath();
  for (let r = r0; r < r1; r++) {
    for (let c = c0; c < c1; c++) {
      const i = r * f.cols + c;
      if (!wrong[i]) continue;
      const k = f.blocks ? f.blocks.blockOf[i] : -1;
      if (k < 0) cross(c * px, r * px, px, px);
      else marked.add(k);
    }
  }
  for (const k of marked) {
    const b = f.blocks!.list[k];
    cross(b.x * px, b.y * px, b.w * px, b.h * px);
  }
  // White halo keeps the red cross visible on red or dark cells.
  ctx.lineWidth = width + 3;
  ctx.strokeStyle = '#ffffff';
  ctx.stroke();
  ctx.lineWidth = width;
  ctx.strokeStyle = WRONG;
  ctx.stroke();
}
