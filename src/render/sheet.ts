// OWNER: render-export agent. Printable sheet as standalone SVG (units = mm).
//
// Text is measured with Helvetica/Arial glyph widths (./textMetrics) because the SVG is built as a string
// without a DOM. Puzzles whose squares would be too small to read on one page are split over several pages
// ("tiles") with row/column numbers; the key is repeated on every page so a child never has to flip.
// Pictograms of simple mode are flattened paths (./pictograms).
// The SVG only uses rect, path and text/tspan with plain hex colours, so export/pdf can redraw it as vectors.
import type { Design, LegendEntry, PaperSize, PuzzleResult } from '../core/types';
import { formatExpression, formatLegendValues, generatePuzzle } from '../core/puzzle';
import { isPictogram, type PictogramId } from '../core/symbols';
import { distinctNames, sortLegendForDisplay } from './legendOrder';
import { getPictogram, PICTO_BOX, PICTO_STROKE, pictogramPath, SYMBOL_INK } from './pictograms';
import { textWidth } from './textMetrics';

export type OkPuzzle = Extract<PuzzleResult, { ok: true }>;
export type SheetKind = 'puzzle' | 'solution';

const PAPER_MM: Record<PaperSize, { w: number; h: number }> = {
  A4: { w: 210, h: 297 },
  Letter: { w: 215.9, h: 279.4 },
};

const FONT_FAMILY = `Helvetica, Arial, 'Liberation Sans', 'Segoe UI', sans-serif`;
/** Distance from the vertical centre of a line to its baseline, in em (≈ half the cap height). */
const BASELINE_SHIFT = 0.35;

/** Page margin (mm); nothing is drawn closer to the paper edge. */
export const MARGIN = 10;
const HEADER_H = 12;
const HEADER_BASELINE = 7;
const HEADER_GAP = 6;
const TITLE_FS = 6;
const TITLE_MIN_FS = 3.5;
const NAME_LINE_W = 60;
const CHECK_W = 6;
const GRID_LEGEND_GAP = 4.5;

const CELL_LINE_W = 0.2;
const BORDER_W = 0.5;
const CELL_TEXT_FILL = 0.86;
const EXPR_MAX_FS = 8;
const EXPR_LINE_H = 1.15;
/** Two-line cells are only used when one line would be smaller than this (≈ 9 pt)… */
const EXPR_COMFORT_FS = 3.2;
/** …and two lines make the text clearly bigger. */
const TWO_LINE_GAIN = 1.2;

/** Legend font size (mm). */
export const LEGEND_FS = 4;
const LEGEND_LINE_H = 5;
const SWATCH = 5.5;
const SWATCH_GAP = 1.5;
const SWATCH_STROKE = 0.35;
/** Each key entry is framed, so entries stay apart without colours too. */
const LEGEND_PAD_X = 1.2;
const LEGEND_PAD_Y = 0.6;
const LEGEND_FRAME_W = 0.25;
const LEGEND_FRAME_R = 1.2;
const LEGEND_ROW_GAP = 1.2;
const LEGEND_COL_GAP = 2.5;
const LEGEND_COL_MIN = 36;

/** Simple mode: key symbols sit in little boxes, like the squares of the grid. */
const KEY_BOX = 7;
const KEY_BOX_GAP = 1.2;
const KEY_BOX_STEP = KEY_BOX + KEY_BOX_GAP;
const KEY_BOX_FS = 4.8;
/** A pictogram's edge as a share of its square, and at most this many mm: the rest is left to the crayon. */
const PICTO_FILL = 0.7;
const PICTO_MAX = 9;
/** In the key nothing is coloured over it, so it may fill more of its box. */
const KEY_PICTO_FILL = 0.8;
/** Pictogram lines (mm): thick enough to print, thin enough to disappear under colour. */
const PICTO_LINE_MIN = 0.16;
const PICTO_LINE_MAX = 0.24;

/** Squares smaller than this (mm) are hard to read and colour: the puzzle is then split over several pages. */
export const TILE_MIN_CELL_MM = 7;
/** At most TILE_MAX × TILE_MAX pages per puzzle. */
const TILE_MAX = 3;
/** When no split reaches TILE_MIN_CELL_MM, more pages are only used for clearly bigger squares. */
const TILE_WORTH = 1.25;
const LABEL_FS = 2.6;
const LABEL_GAP = 1.2;
const LABEL_H = LABEL_FS + LABEL_GAP;
const LABEL_W = textWidth('40', LABEL_FS) + LABEL_GAP;
const LABEL_FILL = '#444444';
const TILE_MAP_CELL = 2.4;

// ---------- small helpers ----------

/** Number → compact SVG coordinate string. */
function n(v: number): string {
  return String(Math.round(v * 100) / 100);
}

export function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function svgRoot(w: number, h: number, unit: string, viewBox: string, body: string, extra = ''): string {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${n(w)}${unit}" height="${n(h)}${unit}" ` +
    `viewBox="${viewBox}"${extra}>${body}</svg>`
  );
}

function colorMap(design: Design): Map<string, { name: string; hex: string }> {
  return new Map(design.palette.map((c) => [c.id, { name: c.name, hex: c.hex }]));
}

function cellHex(design: Design, colors: ReturnType<typeof colorMap>, id: string): string {
  return colors.get(id)?.hex ?? colors.get(design.backgroundId)?.hex ?? '#ffffff';
}

/** A rectangular part of the design grid (the whole grid, or one page of a split puzzle). */
interface Region {
  col0: number;
  row0: number;
  cols: number;
  rows: number;
}

function wholeGrid(design: Design): Region {
  return { col0: 0, row0: 0, cols: design.width, rows: design.height };
}

/** One <rect> per horizontal run of equal colour (far fewer elements than one per cell). */
function cellFills(design: Design, region: Region, x0: number, y0: number, cell: number): string {
  const colors = colorMap(design);
  const at = (r: number, c: number) => design.cells[(region.row0 + r) * design.width + region.col0 + c];
  const out: string[] = [];
  for (let row = 0; row < region.rows; row++) {
    let start = 0;
    for (let col = 1; col <= region.cols; col++) {
      const id = at(row, start);
      if (col < region.cols && at(row, col) === id) continue;
      out.push(
        `<rect x="${n(x0 + start * cell)}" y="${n(y0 + row * cell)}" width="${n((col - start) * cell)}" ` +
          `height="${n(cell)}" fill="${cellHex(design, colors, id)}"/>`,
      );
      start = col;
    }
  }
  return out.join('');
}

/** Inner grid lines as a single path. */
function gridLinesPath(cols: number, rows: number, x0: number, y0: number, cell: number): string {
  const parts: string[] = [];
  for (let c = 1; c < cols; c++) parts.push(`M${n(x0 + c * cell)} ${n(y0)}V${n(y0 + rows * cell)}`);
  for (let r = 1; r < rows; r++) parts.push(`M${n(x0)} ${n(y0 + r * cell)}H${n(x0 + cols * cell)}`);
  return parts.join('');
}

// ---------- page ----------

/** Page size in mm for the design's print settings (orientation 'auto' => landscape if width > height). */
export function pageSizeMm(design: Design): { w: number; h: number } {
  const { w, h } = PAPER_MM[design.print.paper] ?? PAPER_MM.A4;
  const orientation = design.print.orientation;
  const landscape = orientation === 'landscape' || (orientation === 'auto' && design.width > design.height);
  return landscape ? { w: h, h: w } : { w, h };
}

// ---------- legend ----------

interface LegendItem {
  name: string;
  values: string;
  hex: string;
  /** Simple mode: drawn as boxes instead of `values`; '' is an empty box (blank background). */
  symbols?: string[];
}

/** One printed line of a legend entry: values or symbols and/or (part of) the bold name after them. */
interface LegendLine {
  values: string;
  symbols: string[];
  name: string;
}

interface WrappedItem extends LegendItem {
  lines: LegendLine[];
  h: number;
}

interface PlacedItem {
  item: WrappedItem;
  x: number;
  y: number;
  /** Frame height, shared by the entries of a row. */
  h: number;
}

interface LegendBlock {
  w: number;
  h: number;
  colW: number;
  placed: PlacedItem[];
  /** Number of entries that need more than one line (fewer is tidier). */
  wrapped: number;
}

/**
 * Legend items in number order (see sortLegendForDisplay). Names shared by several colours are numbered
 * ("Blue (1)", "Blue (2)") in palette order first, matching the on-screen key.
 */
function legendItems(design: Design, legend: LegendEntry[]): LegendItem[] {
  const colors = colorMap(design);
  const names = distinctNames(legend.map((entry) => colors.get(entry.colorId)?.name ?? '?'));
  const nameOf = new Map(legend.map((entry, i) => [entry.colorId, names[i]]));
  const simple = !!design.puzzle.simple?.on;
  return sortLegendForDisplay(legend, design.puzzle.legendMode).map((entry) => ({
    name: nameOf.get(entry.colorId) ?? '?',
    hex: colors.get(entry.colorId)?.hex ?? '#ffffff',
    // An empty box rather than "□", which the PDF's built-in font does not have.
    ...(simple
      ? { values: '', symbols: entry.blank ? [''] : entry.symbols }
      : { values: formatLegendValues(entry, design.puzzle.legendMode) }),
  }));
}

/** Fallback legend (no values) when a puzzle cannot be generated: one entry per used colour. */
function usedColorItems(design: Design): LegendItem[] {
  const used = new Set(design.cells);
  return design.palette.filter((c) => used.has(c.id)).map((c) => ({ name: c.name, hex: c.hex, values: '' }));
}

const TEXT_X = LEGEND_PAD_X + SWATCH + SWATCH_GAP;

function nameWidth(item: LegendItem): number {
  return TEXT_X + textWidth(item.name, LEGEND_FS, true) + LEGEND_PAD_X;
}

function itemWidth(item: LegendItem): number {
  const values = item.values ? textWidth(` ${item.values}`, LEGEND_FS) : 0;
  const boxes = (item.symbols?.length ?? 0) * KEY_BOX_STEP;
  return nameWidth(item) + values + boxes;
}

/** Splits a word that is wider than `maxW` on its own into pieces that fit. */
function breakWord(word: string, maxW: number, bold: boolean): string[] {
  const pieces: string[] = [];
  let piece = '';
  for (const ch of word) {
    if (piece && textWidth(piece + ch, LEGEND_FS, bold) > maxW) {
      pieces.push(piece);
      piece = ch;
    } else piece += ch;
  }
  if (piece) pieces.push(piece);
  return pieces;
}

/** Greedy word wrap at spaces (very long words are broken anywhere). */
function wrapWords(text: string, maxW: number, bold: boolean): string[] {
  const lines: string[] = [];
  let line = '';
  for (const word of text.split(/\s+/).filter(Boolean).flatMap((w) => breakWord(w, maxW, bold))) {
    const next = line ? `${line} ${word}` : word;
    if (line && textWidth(next, LEGEND_FS, bold) > maxW) {
      lines.push(line);
      line = word;
    } else line = next;
  }
  lines.push(line);
  return lines;
}

/**
 * Fits an entry into a column: the values ("6, 12, 15") or symbol boxes right after the colour box, wrapped
 * when they do not fit, then the bold name (on lines of its own when there is no room left for it).
 */
function wrapItem(item: LegendItem, colW: number): WrappedItem {
  const textW = colW - TEXT_X - LEGEND_PAD_X;
  let line: LegendLine = { values: '', symbols: [], name: '' };
  const lines = [line];
  let used = 0;
  const newLine = () => {
    line = { values: '', symbols: [], name: '' };
    lines.push(line);
    used = 0;
  };
  for (const token of item.values ? item.values.split(/(?<=,)\s+/) : []) {
    if (used > 0 && used + textWidth(` ${token}`, LEGEND_FS) > textW) newLine();
    const text = line.values ? ` ${token}` : token;
    line.values += text;
    used += textWidth(text, LEGEND_FS);
  }
  for (const symbol of item.symbols ?? []) {
    if (used > 0 && used + KEY_BOX_STEP > textW) newLine();
    line.symbols.push(symbol);
    used += KEY_BOX_STEP;
  }

  const space = line.values ? ' ' : '';
  if (used + textWidth(space + item.name, LEGEND_FS, true) <= textW) {
    line.name = item.name;
  } else {
    for (const name of wrapWords(item.name, textW, true)) {
      if (used > 0) newLine();
      line.name = name;
      used = textWidth(name, LEGEND_FS, true);
    }
  }

  const contentH = item.symbols ? lines.length * KEY_BOX_STEP - KEY_BOX_GAP : Math.max(SWATCH, lines.length * LEGEND_LINE_H);
  return { ...item, lines, h: contentH + 2 * LEGEND_PAD_Y };
}

/**
 * Candidate column widths within `maxW`: the widest entry (everything on one line), or narrower widths that
 * allow more columns, with long value lists wrapping. A column is never narrower than the widest colour
 * name, so names never overflow; returns [] when not even one column can hold every name.
 */
function legendColumnWidths(items: LegendItem[], maxW: number): number[] {
  if (items.length === 0) return [];
  const widest = Math.max(...items.map(itemWidth)) + 1;
  const minW = Math.max(LEGEND_COL_MIN, Math.max(...items.map(nameWidth)) + 1);
  const widths = new Set<number>();
  for (let cols = 1; cols <= items.length; cols++) {
    const w = (maxW - (cols - 1) * LEGEND_COL_GAP) / cols;
    if (w < minW) break;
    widths.add(Math.min(widest, w));
  }
  return [...widths];
}

/** Row-major flow of wrapped items into `cols` columns (reading order left → right, top → bottom). */
function arrangeLegend(items: WrappedItem[], colW: number, cols: number): LegendBlock {
  const placed: PlacedItem[] = [];
  let y = 0;
  for (let i = 0; i < items.length; i += cols) {
    const row = items.slice(i, i + cols);
    const h = Math.max(...row.map((it) => it.h));
    row.forEach((item, c) => placed.push({ item, x: c * (colW + LEGEND_COL_GAP), y, h }));
    y += h + LEGEND_ROW_GAP;
  }
  const usedCols = Math.min(cols, items.length);
  return {
    w: usedCols > 0 ? usedCols * colW + (usedCols - 1) * LEGEND_COL_GAP : 0,
    h: items.length > 0 ? y - LEGEND_ROW_GAP : 0,
    colW,
    placed,
    wrapped: items.filter((it) => it.lines.length > 1).length,
  };
}

function maxColumns(colW: number, availW: number): number {
  // Epsilon: widths computed as (availW - gaps) / cols must give back exactly cols columns.
  return Math.max(1, Math.floor((availW + LEGEND_COL_GAP) / (colW + LEGEND_COL_GAP) + 1e-9));
}

// ---------- layout ----------

interface SheetLayout {
  page: { w: number; h: number };
  cell: number;
  gridX: number;
  gridY: number;
  legend: LegendBlock;
  legendX: number;
  legendY: number;
}

/** Space for a grid of `cols` × `rows` squares (plus row/column numbers when `labels`). */
interface GridBox {
  cols: number;
  rows: number;
  labelW: number;
  labelH: number;
  /** Content area (page minus margins and header). */
  cw: number;
  ch: number;
}

interface Candidate {
  cell: number;
  legend: LegendBlock;
  placement: 'below' | 'right';
}

function belowCandidate(box: GridBox, items: LegendItem[], colW: number): Candidate {
  const legend = arrangeLegend(
    items.map((it) => wrapItem(it, colW)),
    colW,
    maxColumns(colW, box.cw),
  );
  const gap = legend.h > 0 ? GRID_LEGEND_GAP : 0;
  const cell = Math.min((box.cw - box.labelW) / box.cols, (box.ch - box.labelH - legend.h - gap) / box.rows);
  return { cell, legend, placement: 'below' };
}

/** Legend beside the grid using the fewest columns whose height fits; null when it never fits. */
function rightCandidate(box: GridBox, items: LegendItem[], colW: number): Candidate | null {
  const wrapped = items.map((it) => wrapItem(it, colW));
  for (let cols = 1; cols <= items.length; cols++) {
    const legend = arrangeLegend(wrapped, colW, cols);
    if (legend.w > box.cw / 2) return null;
    if (legend.h > box.ch) continue;
    const cell = Math.min((box.cw - box.labelW - legend.w - GRID_LEGEND_GAP) / box.cols, (box.ch - box.labelH) / box.rows);
    return { cell, legend, placement: 'right' };
  }
  return null;
}

/** Bigger squares win; on (near) ties the key with fewer wrapped entries, then the earlier candidate. */
function better(a: Candidate, b: Candidate): Candidate {
  if (Math.abs(a.cell - b.cell) > 1e-6) return a.cell > b.cell ? a : b;
  return b.legend.wrapped < a.legend.wrapped ? b : a;
}

/** Tries legend-below and legend-beside arrangements and keeps the best one. */
function bestCandidate(box: GridBox, items: LegendItem[]): Candidate {
  // Names too long for any column: one full-width column in which the names wrap.
  const belowWidths = legendColumnWidths(items, box.cw);
  const candidates = (belowWidths.length > 0 ? belowWidths : [box.cw]).map((colW) => belowCandidate(box, items, colW));
  for (const colW of legendColumnWidths(items, box.cw / 2)) {
    const right = rightCandidate(box, items, colW);
    if (right) candidates.push(right);
  }
  return candidates.reduce(better);
}

function layoutSheet(page: { w: number; h: number }, cols: number, rows: number, labels: boolean, items: LegendItem[]): SheetLayout {
  const box: GridBox = {
    cols,
    rows,
    labelW: labels ? LABEL_W : 0,
    labelH: labels ? LABEL_H : 0,
    cw: page.w - 2 * MARGIN,
    ch: page.h - 2 * MARGIN - HEADER_H,
  };
  const top = MARGIN + HEADER_H;
  const best = bestCandidate(box, items);
  const cell = Math.max(0, best.cell);
  const gridW = cell * cols;
  const gridH = cell * rows;
  const gridY = top + box.labelH;
  if (best.placement === 'right') {
    const blockW = box.labelW + gridW + GRID_LEGEND_GAP + best.legend.w;
    const gridX = MARGIN + (box.cw - blockW) / 2 + box.labelW;
    return { page, cell, gridX, gridY, legend: best.legend, legendX: gridX + gridW + GRID_LEGEND_GAP, legendY: top };
  }
  return {
    page,
    cell,
    gridX: MARGIN + (box.cw - box.labelW - gridW) / 2 + box.labelW,
    gridY,
    legend: best.legend,
    legendX: MARGIN + (box.cw - best.legend.w) / 2,
    legendY: gridY + gridH + GRID_LEGEND_GAP,
  };
}

// ---------- splitting big puzzles over several pages ----------

/** How a sheet is printed: one layout (sized for the biggest tile) and the grid part shown on each page. */
interface SheetPlan {
  layout: SheetLayout;
  tilesX: number;
  tilesY: number;
  /** Row-major, one per page. */
  tiles: Region[];
}

/** Splits `total` squares into `parts` nearly equal runs (bigger ones first). */
function splitRange(total: number, parts: number): { start: number; size: number }[] {
  const base = Math.floor(total / parts);
  const extra = total % parts;
  const out: { start: number; size: number }[] = [];
  let start = 0;
  for (let i = 0; i < parts; i++) {
    const size = base + (i < extra ? 1 : 0);
    out.push({ start, size });
    start += size;
  }
  return out;
}

function tiledPlan(design: Design, items: LegendItem[], tilesX: number, tilesY: number): SheetPlan {
  const colRuns = splitRange(design.width, tilesX);
  const rowRuns = splitRange(design.height, tilesY);
  const tiled = tilesX * tilesY > 1;
  const layout = layoutSheet(pageSizeMm(design), colRuns[0].size, rowRuns[0].size, tiled, items);
  const tiles = rowRuns.flatMap((r) => colRuns.map((c) => ({ col0: c.start, row0: r.start, cols: c.size, rows: r.size })));
  return { layout, tilesX, tilesY, tiles };
}

/**
 * The whole grid on one page when its squares are at least TILE_MIN_CELL_MM; otherwise the fewest pages
 * (up to 3 × 3) that reach that size, or the split with the biggest squares when none does.
 */
function planPuzzle(design: Design, items: LegendItem[]): SheetPlan {
  let best = tiledPlan(design, items, 1, 1);
  if (best.layout.cell >= TILE_MIN_CELL_MM) return best;
  for (let pages = 2; pages <= TILE_MAX * TILE_MAX; pages++) {
    let bestHere: SheetPlan | null = null;
    for (let tx = 1; tx <= TILE_MAX; tx++) {
      const ty = pages / tx;
      if (!Number.isInteger(ty) || ty > TILE_MAX || tx > design.width || ty > design.height) continue;
      const plan = tiledPlan(design, items, tx, ty);
      if (!bestHere || plan.layout.cell > bestHere.layout.cell) bestHere = plan;
    }
    if (!bestHere) continue;
    if (bestHere.layout.cell >= TILE_MIN_CELL_MM) return bestHere;
    if (bestHere.layout.cell > best.layout.cell * TILE_WORTH) best = bestHere;
  }
  return best;
}

// ---------- sheet parts ----------

/** Title shrinks to fit the available width, then is truncated with "…" below a minimum size. */
function titleSvg(text: string, x: number, availW: number): string {
  if (!text || availW <= 0) return '';
  let fs = Math.min(TITLE_FS, availW / Math.max(1e-6, textWidth(text, 1, true)));
  let shown = text;
  if (fs < TITLE_MIN_FS) {
    fs = TITLE_MIN_FS;
    const chars = [...text];
    while (chars.length > 1 && textWidth(`${chars.join('')}…`, fs, true) > availW) chars.pop();
    shown = `${chars.join('').trimEnd()}…`;
  }
  return (
    `<text x="${n(x)}" y="${n(MARGIN + HEADER_BASELINE)}" font-size="${n(fs)}" font-weight="bold">` +
    `${escapeXml(shown)}</text>`
  );
}

/** A path from absolute points relative to (x, y); `closed` adds Z. */
function polyPath(x: number, y: number, points: [number, number][], closed: boolean): string {
  const d = points.map(([px, py], i) => `${i === 0 ? 'M' : 'L'}${n(x + px)} ${n(y + py)}`).join('');
  return closed ? `${d}Z` : d;
}

/** Language-free "write your name here" line: a pencil (drawn as a path, so every font and the PDF agree) + underline. */
function nameLineSvg(pageW: number): string {
  const right = pageW - MARGIN;
  const left = right - NAME_LINE_W;
  const y = MARGIN + HEADER_BASELINE;
  const body = polyPath(left, y, [[0, 0], [0.6, -1.9], [3.3, -4.6], [4.6, -3.3], [1.9, -0.6]], true);
  const tip = polyPath(left, y, [[0.6, -1.9], [1.9, -0.6]], false);
  return (
    `<path class="pencil" d="${body}${tip}" fill="none" stroke="#000" stroke-width="0.3" stroke-linejoin="round"/>` +
    `<path d="M${n(left + 7)} ${n(y + 0.5)}H${n(right)}" stroke="#000" stroke-width="0.3"/>`
  );
}

/** Check mark marking the solution page. */
function checkSvg(x: number): string {
  const y = MARGIN + HEADER_BASELINE;
  const d = polyPath(x, y, [[0.3, -2.2], [1.8, -0.4], [4.6, -4.4]], false);
  return `<path class="check" d="${d}" fill="none" stroke="#000" stroke-width="0.7" stroke-linecap="round" stroke-linejoin="round"/>`;
}

/** Position of a page in a split puzzle. */
interface TileInfo {
  index: number;
  tilesX: number;
  tilesY: number;
}

function tileMapWidth(tile: TileInfo): number {
  return tile.tilesX * TILE_MAP_CELL;
}

/** Language-free page marker: a small map of all pages with this one filled in. */
function tileMapSvg(tile: TileInfo, right: number): string {
  const x0 = right - tileMapWidth(tile);
  const y0 = MARGIN + HEADER_BASELINE + 0.5 - tile.tilesY * TILE_MAP_CELL;
  const out: string[] = [];
  for (let i = 0; i < tile.tilesX * tile.tilesY; i++) {
    const x = x0 + (i % tile.tilesX) * TILE_MAP_CELL;
    const y = y0 + Math.floor(i / tile.tilesX) * TILE_MAP_CELL;
    out.push(
      `<rect x="${n(x)}" y="${n(y)}" width="${TILE_MAP_CELL}" height="${TILE_MAP_CELL}" ` +
        `fill="${i === tile.index ? '#000000' : '#ffffff'}" stroke="#000" stroke-width="0.25"/>`,
    );
  }
  return `<g class="tile-map">${out.join('')}</g>`;
}

function headerSvg(design: Design, kind: SheetKind, pageW: number, tile: TileInfo | null): string {
  const cw = pageW - 2 * MARGIN;
  const name = design.print.showTitle ? design.name.trim() : '';
  if (kind === 'solution') return checkSvg(MARGIN) + titleSvg(name, MARGIN + CHECK_W, cw - CHECK_W);
  const mapRight = pageW - MARGIN - NAME_LINE_W - HEADER_GAP;
  const map = tile ? tileMapSvg(tile, mapRight) : '';
  const titleW = cw - NAME_LINE_W - HEADER_GAP - (tile ? tileMapWidth(tile) + HEADER_GAP : 0);
  return titleSvg(name, MARGIN, titleW) + map + nameLineSvg(pageW);
}

interface ExprStyle {
  fs: number;
  twoLines: boolean;
}

/** Splits "12 + 7" into ["12 +", "7"]; texts without a space stay on one line. */
function splitExpression(text: string): string[] {
  const i = text.lastIndexOf(' ');
  return i < 0 ? [text] : [text.slice(0, i), text.slice(i + 1)];
}

/**
 * One uniform font size for the whole grid, from the cell size and the widest expression. When the cells
 * are too narrow for "12 + 7" at a comfortable size on one line, every cell uses two lines ("12 +" / "7")
 * if that is clearly larger.
 */
function expressionStyle(texts: string[], cell: number): ExprStyle {
  const inner = cell * CELL_TEXT_FILL;
  const widest = (parts: string[]) => Math.max(1e-6, ...parts.map((t) => textWidth(t, 1)));
  const oneLine = Math.min(EXPR_MAX_FS, inner / widest(texts), inner / EXPR_LINE_H);
  const twoLine = Math.min(EXPR_MAX_FS, inner / widest(texts.flatMap(splitExpression)), inner / (2 * EXPR_LINE_H));
  const useTwo = oneLine < EXPR_COMFORT_FS && twoLine > oneLine * TWO_LINE_GAIN;
  return useTwo ? { fs: twoLine, twoLines: true } : { fs: oneLine, twoLines: false };
}

function expressionText(text: string, cx: number, cy: number, style: ExprStyle): string {
  const shift = BASELINE_SHIFT * style.fs;
  const parts = style.twoLines ? splitExpression(text) : [text];
  if (parts.length === 1) return `<text x="${n(cx)}" y="${n(cy + shift)}">${escapeXml(text)}</text>`;
  const half = (EXPR_LINE_H * style.fs) / 2;
  return (
    `<text x="${n(cx)}" y="${n(cy - half + shift)}">${escapeXml(parts[0])}` +
    `<tspan x="${n(cx)}" y="${n(cy + half + shift)}">${escapeXml(parts[1])}</tspan></text>`
  );
}

function expressionsSvg(design: Design, texts: string[], style: ExprStyle, layout: SheetLayout, region: Region, ink: string): string {
  const out: string[] = [];
  for (let r = 0; r < region.rows; r++) {
    for (let c = 0; c < region.cols; c++) {
      const text = texts[(region.row0 + r) * design.width + region.col0 + c];
      if (!text) continue;
      const cx = layout.gridX + (c + 0.5) * layout.cell;
      const cy = layout.gridY + (r + 0.5) * layout.cell;
      out.push(expressionText(text, cx, cy, style));
    }
  }
  return `<g font-size="${n(style.fs)}" text-anchor="middle" fill="${ink}">${out.join('')}</g>`;
}

/** A pictogram centred on (cx, cy): plain M/L/Z paths, so export/pdf draws it as vectors. */
function pictogramSvg(id: PictogramId, cx: number, cy: number, size: number): string {
  const { line, dots } = getPictogram(id);
  const scale = size / PICTO_BOX;
  const x = cx - size / 2;
  const y = cy - size / 2;
  const width = Math.min(PICTO_LINE_MAX, Math.max(PICTO_LINE_MIN, PICTO_STROKE * scale));
  const outline =
    `<path d="${pictogramPath(line, x, y, scale)}" fill="none" stroke="${SYMBOL_INK}" stroke-width="${n(width)}" ` +
    `stroke-linecap="round" stroke-linejoin="round"/>`;
  return outline + (dots.length ? `<path d="${pictogramPath(dots, x, y, scale)}" fill="${SYMBOL_INK}"/>` : '');
}

function pictogramsSvg(design: Design, symbols: readonly (string | null)[], layout: SheetLayout, region: Region): string {
  const size = Math.min(PICTO_MAX, layout.cell * PICTO_FILL);
  const out: string[] = [];
  for (let r = 0; r < region.rows; r++) {
    for (let c = 0; c < region.cols; c++) {
      const symbol = symbols[(region.row0 + r) * design.width + region.col0 + c];
      if (!symbol || !isPictogram(symbol)) continue;
      out.push(pictogramSvg(symbol, layout.gridX + (c + 0.5) * layout.cell, layout.gridY + (r + 0.5) * layout.cell, size));
    }
  }
  return out.length ? `<g class="pictograms">${out.join('')}</g>` : '';
}

/** Row and column numbers (1-based, of the whole design) around a page of a split puzzle. */
function labelsSvg(layout: SheetLayout, region: Region): string {
  const { gridX, gridY, cell } = layout;
  const fs = Math.min(LABEL_FS, cell * 0.45);
  const cols = Array.from(
    { length: region.cols },
    (_, c) => `<text x="${n(gridX + (c + 0.5) * cell)}" y="${n(gridY - LABEL_GAP)}">${region.col0 + c + 1}</text>`,
  );
  const rows = Array.from(
    { length: region.rows },
    (_, r) =>
      `<text x="${n(gridX - LABEL_GAP)}" y="${n(gridY + (r + 0.5) * cell + BASELINE_SHIFT * fs)}">${region.row0 + r + 1}</text>`,
  );
  return (
    `<g class="col-labels" font-size="${n(fs)}" text-anchor="middle" fill="${LABEL_FILL}">${cols.join('')}</g>` +
    `<g class="row-labels" font-size="${n(fs)}" text-anchor="end" fill="${LABEL_FILL}">${rows.join('')}</g>`
  );
}

function gridFrameSvg(layout: SheetLayout, region: Region): string {
  const { gridX: x, gridY: y, cell } = layout;
  return (
    `<path d="${gridLinesPath(region.cols, region.rows, x, y, cell)}" stroke="#555" stroke-width="${CELL_LINE_W}" fill="none"/>` +
    `<rect x="${n(x)}" y="${n(y)}" width="${n(cell * region.cols)}" height="${n(cell * region.rows)}" ` +
    `fill="none" stroke="#000" stroke-width="${BORDER_W}"/>`
  );
}

function swatchSvg(item: LegendItem, x: number, y: number, filled: boolean): string {
  return (
    `<rect x="${n(x)}" y="${n(y)}" width="${SWATCH}" height="${SWATCH}" rx="0.6" ` +
    `fill="${filled ? item.hex : '#ffffff'}" stroke="#000" stroke-width="${SWATCH_STROKE}"/>`
  );
}

/** One symbol of the simple-mode key in its box, with the box's left edge at x and centred on cy. */
function keyBoxSvg(symbol: string, x: number, cy: number): string {
  const cx = x + KEY_BOX / 2;
  const box =
    `<rect class="key-box" x="${n(x)}" y="${n(cy - KEY_BOX / 2)}" width="${KEY_BOX}" height="${KEY_BOX}" ` +
    `fill="none" stroke="#000" stroke-width="${CELL_LINE_W}"/>`;
  if (!symbol) return box;
  if (isPictogram(symbol)) return box + pictogramSvg(symbol, cx, cy, KEY_BOX * KEY_PICTO_FILL);
  const baseline = cy + BASELINE_SHIFT * KEY_BOX_FS;
  return `${box}<text x="${n(cx)}" y="${n(baseline)}" font-size="${KEY_BOX_FS}" text-anchor="middle" fill="${SYMBOL_INK}">${escapeXml(symbol)}</text>`;
}

/** Simple-mode key entry: colour box, the boxed symbols (wrapped as wrapItem decided), then the name. */
function symbolItemSvg({ item, x, y }: PlacedItem, filled: boolean): string {
  const tx = x + TEXT_X;
  const top = y + LEGEND_PAD_Y;
  const out = [swatchSvg(item, x + LEGEND_PAD_X, top + (KEY_BOX - SWATCH) / 2, filled)];
  item.lines.forEach((line, i) => {
    const cy = top + KEY_BOX / 2 + i * KEY_BOX_STEP;
    line.symbols.forEach((symbol, k) => out.push(keyBoxSvg(symbol, tx + k * KEY_BOX_STEP, cy)));
    if (!line.name) return;
    const nameX = tx + line.symbols.length * KEY_BOX_STEP;
    out.push(`<text x="${n(nameX)}" y="${n(cy + BASELINE_SHIFT * LEGEND_FS)}" font-weight="bold">${escapeXml(line.name)}</text>`);
  });
  return out.join('');
}

/** Maths key entry: colour box, the values, then the name. */
function valueItemSvg({ item, x, y }: PlacedItem, filled: boolean): string {
  const tx = x + TEXT_X;
  const top = y + LEGEND_PAD_Y;
  const baseline = top + SWATCH / 2 + BASELINE_SHIFT * LEGEND_FS;
  const lines = item.lines.map((line, i) => {
    const pos = i === 0 ? '' : ` x="${n(tx)}" dy="${LEGEND_LINE_H}"`;
    const values = line.values ? `<tspan${pos}>${escapeXml(line.values)}</tspan>` : '';
    if (!line.name) return values;
    const name = escapeXml(line.values ? ` ${line.name}` : line.name);
    return `${values}<tspan${line.values ? '' : pos} font-weight="bold">${name}</tspan>`;
  });
  return `${swatchSvg(item, x + LEGEND_PAD_X, top, filled)}<text x="${n(tx)}" y="${n(baseline)}">${lines.join('')}</text>`;
}

function legendItemSvg(placed: PlacedItem, colW: number, filled: boolean): string {
  const { item, x, y, h } = placed;
  const frame =
    `<rect class="key-entry" x="${n(x)}" y="${n(y)}" width="${n(colW)}" height="${n(h)}" rx="${LEGEND_FRAME_R}" ` +
    `fill="none" stroke="#000" stroke-width="${LEGEND_FRAME_W}"/>`;
  return frame + (item.symbols ? symbolItemSvg(placed, filled) : valueItemSvg(placed, filled));
}

function legendSvg(layout: SheetLayout, filled: boolean): string {
  const { colW, placed } = layout.legend;
  const items = placed.map((p) =>
    legendItemSvg({ ...p, x: layout.legendX + p.x, y: layout.legendY + p.y }, colW, filled),
  );
  return `<g class="legend" font-size="${LEGEND_FS}" fill="#000">${items.join('')}</g>`;
}

function pageSvg(page: { w: number; h: number }, content: string): string {
  const { w, h } = page;
  const body =
    `<rect width="${n(w)}" height="${n(h)}" fill="#ffffff"/>` + `<g font-family="${FONT_FAMILY}" fill="#000">${content}</g>`;
  return svgRoot(w, h, 'mm', `0 0 ${n(w)} ${n(h)}`, body);
}

function solutionPage(design: Design, items: LegendItem[]): string {
  const layout = tiledPlan(design, items, 1, 1).layout;
  const region = wholeGrid(design);
  return pageSvg(
    layout.page,
    headerSvg(design, 'solution', layout.page.w, null) +
      cellFills(design, region, layout.gridX, layout.gridY, layout.cell) +
      gridFrameSvg(layout, region) +
      legendSvg(layout, true),
  );
}

function puzzlePages(design: Design, puzzle: OkPuzzle, plan: SheetPlan): string[] {
  const { layout, tiles, tilesX, tilesY } = plan;
  // Blank (background) cells have no expression and stay empty.
  const { symbols } = puzzle;
  const texts = symbols
    ? symbols.map((s) => (s && !isPictogram(s) ? s : ''))
    : puzzle.expressions.map((e) => (e ? formatExpression(e, design.print) : ''));
  const style = expressionStyle(texts.filter(Boolean), layout.cell);
  const split = tiles.length > 1;
  return tiles.map((region, index) =>
    pageSvg(
      layout.page,
      headerSvg(design, 'puzzle', layout.page.w, split ? { index, tilesX, tilesY } : null) +
        expressionsSvg(design, texts, style, layout, region, symbols ? SYMBOL_INK : '#000') +
        (symbols ? pictogramsSvg(design, symbols, layout, region) : '') +
        gridFrameSvg(layout, region) +
        (split ? labelsSvg(layout, region) : '') +
        legendSvg(layout, design.print.legendSwatches),
    ),
  );
}

// ---------- public API ----------

/**
 * The sheet exactly as printed / exported, one SVG per page (xmlns set, width/height in mm, viewBox in mm).
 * 'puzzle': B/W grid with expressions + legend (values/range + colour name); big grids are split over
 * several pages (see sheetPageCount). 'solution': one page, coloured grid + legend with swatches.
 */
export function renderSheetPages(design: Design, puzzle: OkPuzzle, kind: SheetKind): string[] {
  const items = legendItems(design, puzzle.legend);
  if (kind === 'solution') return [solutionPage(design, items)];
  return puzzlePages(design, puzzle, planPuzzle(design, items));
}

/** The whole sheet on a single page (an overview; printing uses renderSheetPages, which may split it). */
export function renderSheetSVG(design: Design, puzzle: OkPuzzle, kind: SheetKind): string {
  const items = legendItems(design, puzzle.legend);
  if (kind === 'solution') return solutionPage(design, items);
  return puzzlePages(design, puzzle, tiledPlan(design, items, 1, 1))[0];
}

/**
 * Coloured picture SVG (thumbnails, PNG export). `frame` adds a one-square white margin and a thin grey
 * outline so light pictures stand out on any background (for exported images, not thumbnails).
 */
export function renderDesignSVG(design: Design, opts?: { cellPx?: number; gridLines?: boolean; frame?: boolean }): string {
  const px = opts?.cellPx ?? 16;
  const { width: cols, height: rows } = design;
  const lines = opts?.gridLines
    ? `<path d="${gridLinesPath(cols, rows, 0, 0, 1)}" stroke="#000" stroke-opacity="0.2" stroke-width="${n(1 / px)}" fill="none"/>`
    : '';
  const fills = cellFills(design, wholeGrid(design), 0, 0, 1);
  if (!opts?.frame) return svgRoot(cols * px, rows * px, '', `0 0 ${cols} ${rows}`, fills + lines, ' shape-rendering="crispEdges"');
  const stroke = n(Math.max(1, px / 24) / px);
  const body =
    `<rect x="-1" y="-1" width="${cols + 2}" height="${rows + 2}" fill="#ffffff"/>` +
    fills +
    lines +
    `<rect width="${cols}" height="${rows}" fill="none" stroke="#cccccc" stroke-width="${stroke}"/>`;
  return svgRoot((cols + 2) * px, (rows + 2) * px, '', `-1 -1 ${cols + 2} ${rows + 2}`, body, ' shape-rendering="crispEdges"');
}

function printPlan(design: Design): SheetPlan {
  const puzzle = generatePuzzle(design);
  const items = puzzle.ok ? legendItems(design, puzzle.legend) : usedColorItems(design);
  return planPuzzle(design, items);
}

/** Square edge length in mm on the printed puzzle pages (after any split); UI warns when < TILE_MIN_CELL_MM. */
export function sheetCellSizeMm(design: Design): number {
  return printPlan(design).layout.cell;
}

/** Number of puzzle pages (> 1 when the grid is split so its squares stay readable); solution not included. */
export function sheetPageCount(design: Design): number {
  return printPlan(design).tiles.length;
}
