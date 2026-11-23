// Blocks (multicell puzzles): neighbouring cells of one colour are joined into rectangles that share one
// expression or symbol, so a big picture has far fewer sums to work out. Pure and deterministic.
import { createRng, mixSeed } from './rng';
import type { Block, Design } from './types';

export interface BlockSettings {
  /** Join cells into blocks. */
  on: boolean;
  /**
   * Mix big and small blocks everywhere. Block edges always follow the colour edges; with only big blocks the
   * flat areas become a regular pattern and the picture's outline stands out among the small blocks around it.
   */
  hideOutline: boolean;
  /** Maths: blocks of HARD_BLOCK_AREA cells or more get a three-number expression. */
  harderSums: boolean;
}

/** Longest side of a block, in cells. */
export const BLOCK_MAX_SIDE = 3;
/** Blocks with at least this many cells get the longer sums of `harderSums`. */
export const HARD_BLOCK_AREA = 4;
/** Grids with more cells than this (bigger than 24 × 24) start with blocks on. */
export const BLOCKS_AUTO_CELLS = 24 * 24;

const BLOCK_SALT = 0xb10c;

/** Settings for a design that never chose: blocks on for big grids, longer sums, outline not hidden. */
export function defaultBlocks(width: number, height: number): BlockSettings {
  return { on: width * height > BLOCKS_AUTO_CELLS, hideOutline: false, harderSums: true };
}

/** The design's block settings, or the defaults for its size when it has none. */
export function resolveBlocks(design: Pick<Design, 'width' | 'height' | 'puzzle'>): BlockSettings {
  return design.puzzle.blocks ?? defaultBlocks(design.width, design.height);
}

/** Block settings from untrusted data; undefined when there are none. */
export function cleanBlocks(raw: unknown): BlockSettings | undefined {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return undefined;
  const own = (key: keyof BlockSettings): unknown => (Object.hasOwn(raw, key) ? (raw as Record<string, unknown>)[key] : undefined);
  return { on: own('on') === true, hideOutline: own('hideOutline') === true, harderSums: own('harderSums') !== false };
}

/**
 * Covers every cell with class ≥ 0 (−1 = blank, never in a block) with one-class rectangles of at most
 * BLOCK_MAX_SIDE × BLOCK_MAX_SIDE cells. Cells are visited in reading order; each still uncovered one becomes
 * the top-left corner of a block chosen among the rectangles that fit there: the biggest one, or with
 * `hideOutline` a random one weighted by its area. Blocks come out in reading order of their corners, and each
 * choice depends only on the seed and that corner, so a change in one part of the picture stays local.
 */
export function tileBlocks(
  width: number,
  height: number,
  classOf: ArrayLike<number>,
  hideOutline: boolean,
  seed: number,
): Block[] {
  const covered = new Uint8Array(width * height);
  const blocks: Block[] = [];
  const fits: { w: number; h: number; area: number }[] = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      const c = classOf[i];
      if (covered[i] || c < 0) continue;
      // Rectangles anchored here, row by row: a row may only be as long as every row above it.
      fits.length = 0;
      let maxW = BLOCK_MAX_SIDE;
      for (let h = 1; h <= BLOCK_MAX_SIDE && y + h <= height; h++) {
        const row = (y + h - 1) * width;
        let run = 0;
        while (run < maxW && x + run < width && !covered[row + x + run] && classOf[row + x + run] === c) run++;
        maxW = run;
        if (maxW === 0) break;
        for (let w = 1; w <= maxW; w++) fits.push({ w, h, area: w * h });
      }
      const block = chooseFit(fits, hideOutline, mixSeed(seed, BLOCK_SALT, i));
      for (let dy = 0; dy < block.h; dy++) covered.fill(1, (y + dy) * width + x, (y + dy) * width + x + block.w);
      blocks.push({ x, y, w: block.w, h: block.h });
    }
  }
  return blocks;
}

function chooseFit(fits: { w: number; h: number; area: number }[], hideOutline: boolean, seed: number): { w: number; h: number } {
  if (fits.length === 1) return fits[0];
  const rng = createRng(seed);
  if (hideOutline) {
    let target = rng.next() * fits.reduce((sum, f) => sum + f.area, 0);
    for (const f of fits) {
      target -= f.area;
      if (target < 0) return f;
    }
    return fits[fits.length - 1];
  }
  const best = Math.max(...fits.map((f) => f.area));
  // Equal areas (3 × 1 or 1 × 3) are decided by the seed, so flat areas do not all run the same way.
  return rng.pick(fits.filter((f) => f.area === best));
}

/** blockOf[cell] = index of the block holding it, −1 for cells in no block (blank). */
export function blockIndex(width: number, cellCount: number, blocks: readonly Block[]): Int32Array {
  const blockOf = new Int32Array(cellCount).fill(-1);
  blocks.forEach((b, k) => {
    for (let dy = 0; dy < b.h; dy++) blockOf.fill(k, (b.y + dy) * width + b.x, (b.y + dy) * width + b.x + b.w);
  });
  return blockOf;
}

/** Row-major cell indexes of a block. */
export function blockCells(width: number, b: Block): number[] {
  const cells: number[] = [];
  for (let dy = 0; dy < b.h; dy++) for (let dx = 0; dx < b.w; dx++) cells.push((b.y + dy) * width + b.x + dx);
  return cells;
}
