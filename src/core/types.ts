import type { BlockSettings } from './blocks';
import type { SimpleSettings } from './symbols';

/**
 * SquareMath core data model. THIS FILE IS THE SHARED CONTRACT — every module builds on it.
 *
 * Concept: a Design is a pixel-art picture on a W×H grid. Every cell holds a palette colour id.
 * A Puzzle is generated from a Design: every cell gets an arithmetic expression; solving it gives
 * a number, and the Legend maps numbers (exact values or ranges) to colour NAMES. The printed sheet
 * is black & white: the grid with expressions + the legend (colour name → values/range).
 * In simple mode (PuzzleSettings.simple.on) there is no maths: every cell shows a symbol (number, letter
 * or pictogram) and the legend lists the symbols of each colour. See ./symbols.
 * With blocks (PuzzleSettings.blocks, see ./blocks) neighbouring cells of one colour are joined into rectangles
 * that share one expression or symbol, so big pictures have far fewer sums.
 */

export type Op = 'add' | 'sub' | 'mul' | 'div';
export const ALL_OPS: Op[] = ['add', 'sub', 'mul', 'div'];

export interface PaletteColor {
  /** Stable id, unique within the design (short random string). */
  id: string;
  /** English colour name shown on the printed legend, e.g. "Red", "Sky blue". User-editable. */
  name: string;
  /** Display colour, '#rrggbb' lowercase. */
  hex: string;
}

export interface PuzzleSettings {
  /** Operations used; at least one. Mixed when more than one. */
  ops: Op[];
  /** Addition: sum ≤ addSubMax. Subtraction: minuend ≤ addSubMax, result ≥ 0. Operands ≥ 1. */
  addSubMax: number;
  /** Multiplication: both factors in 1..mulDivMax. Division: divisor and quotient in 1..mulDivMax (exact). */
  mulDivMax: number;
  /** 'range': each colour ↔ an interval of results (e.g. Red 1–10). 'value': each colour ↔ a few exact results. */
  legendMode: 'range' | 'value';
  /** uint32 seed; the same design + settings + seed always yields the identical puzzle. */
  seed: number;
  /** Cells of the background colour get no expression: they stay empty on the sheet (default on). */
  blankBackground: boolean;
  /**
   * Simple mode. Absent in designs that never used it, so their files, share links and saved progress stay
   * as they were; the maths settings above are ignored while `on`.
   */
  simple?: SimpleSettings;
  /**
   * Joining cells into blocks. Absent until the user changes it: then resolveBlocks (./blocks) turns blocks on
   * for big grids only. Designs, share links and saved progress made before blocks existed stay as they were.
   */
  blocks?: BlockSettings;
}

export type PaperSize = 'A4' | 'Letter';

export interface PrintSettings {
  paper: PaperSize;
  orientation: 'auto' | 'portrait' | 'landscape';
  /** Symbol for division on the sheet (':' is common in much of Europe). */
  divSymbol: '÷' | ':';
  /** Symbol for multiplication on the sheet. */
  mulSymbol: '×' | '·';
  /** Print the design name as the sheet title. */
  showTitle: boolean;
  /** Add a second page with the coloured solution. */
  includeSolution: boolean;
  /** Draw a filled colour swatch next to each legend entry (off by default: sheets are B/W). */
  legendSwatches: boolean;
}

export interface Design {
  id: string;
  name: string;
  /** Columns, GRID_MIN..GRID_MAX */
  width: number;
  /** Rows, GRID_MIN..GRID_MAX */
  height: number;
  /** 1..MAX_PALETTE entries, ids unique. */
  palette: PaletteColor[];
  /** Palette id used by the eraser, for new cells (resize) and when a colour is deleted. Must exist in palette. */
  backgroundId: string;
  /** Row-major, length === width*height, every entry is an id present in palette. */
  cells: string[];
  puzzle: PuzzleSettings;
  print: PrintSettings;
  /** epoch ms */
  createdAt: number;
  /** epoch ms */
  updatedAt: number;
}

export const GRID_MIN = 4;
export const GRID_MAX = 40;
export const MAX_PALETTE = 24;
export const NAME_MAX = 60;
/** Allowed range of PuzzleSettings.addSubMax (inclusive). */
export const ADD_SUB_LIMITS = { min: 5, max: 1000 } as const;
/** Allowed range of PuzzleSettings.mulDivMax (inclusive). */
export const MUL_DIV_LIMITS = { min: 2, max: 20 } as const;

/**
 * One generated expression: `a op b = result`, or `a op b op2 c = result` (worked left to right; both ops of the
 * same kind, + − or × ÷, so the order never matters) for a big block with PuzzleSettings.blocks.harderSums.
 * Operands/results are non-negative integers.
 */
export interface Expression {
  a: number;
  b: number;
  op: Op;
  result: number;
  /** Second step of a three-number expression; `c` and `op2` are both present or both absent. */
  op2?: Op;
  c?: number;
}

/** A rectangle of cells (x, y = top-left column and row) of one colour that shares one expression or symbol. */
export interface Block {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface LegendEntry {
  colorId: string;
  /** Inclusive bounds of the results assigned to this colour (range mode shows "min–max"). */
  min: number;
  max: number;
  /** Sorted list of results that actually occur / are assigned to this colour (value mode shows these). */
  values: number[];
  /**
   * The colour's cells have no expression (PuzzleSettings.blankBackground): the key tells the child to colour
   * the empty boxes with it. Only listed for a background that is not paper-white; min/max are 0, values empty.
   */
  blank?: boolean;
  /** Simple mode: the symbols standing for this colour, in reading order (min = max = rank of the first). */
  symbols?: string[];
}

export type PuzzleError =
  /** More distinct colours used than distinct results achievable with the chosen ops/limits. */
  | { code: 'tooManyColors'; colorsUsed: number; resultsAvailable: number }
  /** Simple mode: more colours used than the symbol set has symbols. */
  | { code: 'tooFewSymbols'; colorsUsed: number; symbolsAvailable: number }
  | { code: 'noOps' };

export type PuzzleResult =
  | {
      ok: true;
      /** Same order/length as design.cells; null = blank cell (background with blankBackground on). */
      expressions: (Expression | null)[];
      /** Simple mode only: the symbol per cell (null = blank); `expressions` are then all null. */
      symbols?: (string | null)[];
      /**
       * Only when blocks are on: every non-blank cell lies in exactly one block (1×1 blocks included), in reading
       * order of their top-left cells. All cells of a block hold the same expression (or symbol).
       */
      blocks?: Block[];
      /** One entry per colour actually used in the design, in palette order. Result sets are disjoint. */
      legend: LegendEntry[];
    }
  | { ok: false; error: PuzzleError };

export const DEFAULT_PUZZLE: PuzzleSettings = {
  ops: ['add', 'sub'],
  addSubMax: 20,
  mulDivMax: 10,
  legendMode: 'range',
  seed: 1,
  blankBackground: true,
};

export const DEFAULT_PRINT: PrintSettings = {
  paper: 'A4',
  orientation: 'auto',
  divSymbol: '÷',
  mulSymbol: '×',
  showTitle: true,
  includeSolution: false,
  legendSwatches: false,
};

/** File format for export/import of the local library. */
export interface LibraryFile {
  app: 'squaremath';
  version: 1;
  exportedAt: number;
  designs: Design[];
}
