import { describe, expect, it } from 'vitest';
import { carriedState, readCarriedSettings } from '../pages/puzzle/settings';
import { progressKey } from '../state/progress';
import {
  BLOCK_MAX_SIDE,
  BLOCKS_AUTO_CELLS,
  blockCells,
  blockIndex,
  cleanBlocks,
  defaultBlocks,
  resolveBlocks,
  tileBlocks,
  type BlockSettings,
} from './blocks';
import { decodeDesign, encodeDesign } from './codec';
import { cloneDesign, normalizeDesign } from './design';
import { libraryToJson, parseLibraryFile, parseStoredLibrary, storedLibraryToJson } from './fileio';
import { createRng } from './rng';
import { TEMPLATES } from './samples';
import type { Block, Design } from './types';

/** Classes from rows of characters: '.' = blank (−1), any other character is its own class. */
function classes(rows: string[]): { width: number; height: number; classOf: Int32Array } {
  const chars = rows.join('');
  return {
    width: rows[0].length,
    height: rows.length,
    classOf: Int32Array.from(chars, (ch) => (ch === '.' ? -1 : ch.charCodeAt(0))),
  };
}

/** Every non-blank cell in exactly one block of one class, no blank cell in a block, sides within the limit. */
function expectValidTiling(width: number, height: number, classOf: Int32Array, blocks: Block[]) {
  const seen = new Int32Array(width * height);
  for (const b of blocks) {
    expect(b.w).toBeGreaterThanOrEqual(1);
    expect(b.h).toBeGreaterThanOrEqual(1);
    expect(b.w).toBeLessThanOrEqual(BLOCK_MAX_SIDE);
    expect(b.h).toBeLessThanOrEqual(BLOCK_MAX_SIDE);
    expect(b.x + b.w).toBeLessThanOrEqual(width);
    expect(b.y + b.h).toBeLessThanOrEqual(height);
    const cells = blockCells(width, b);
    expect(new Set(cells.map((i) => classOf[i])).size).toBe(1);
    for (const i of cells) seen[i]++;
  }
  classOf.forEach((c, i) => expect(seen[i]).toBe(c < 0 ? 0 : 1));
  // Reading order of the top-left cells.
  const corners = blocks.map((b) => b.y * width + b.x);
  expect(corners).toEqual([...corners].sort((a, b) => a - b));
}

describe('block settings', () => {
  it('are on by default only for grids bigger than 24 × 24', () => {
    expect(BLOCKS_AUTO_CELLS).toBe(576);
    expect(defaultBlocks(24, 24).on).toBe(false);
    expect(defaultBlocks(16, 16).on).toBe(false);
    expect(defaultBlocks(25, 24).on).toBe(true);
    expect(defaultBlocks(40, 40)).toEqual({ on: true, hideOutline: false, harderSums: true });
  });

  it('use the chosen settings over the defaults', () => {
    const blocks = { on: false, hideOutline: true, harderSums: false };
    expect(resolveBlocks({ width: 40, height: 40, puzzle: { blocks } as never })).toBe(blocks);
    expect(resolveBlocks({ width: 40, height: 40, puzzle: {} as never }).on).toBe(true);
  });

  it('are cleaned from untrusted data', () => {
    expect(cleanBlocks(undefined)).toBeUndefined();
    expect(cleanBlocks('on')).toBeUndefined();
    expect(cleanBlocks([true])).toBeUndefined();
    expect(cleanBlocks({})).toEqual({ on: false, hideOutline: false, harderSums: true });
    expect(cleanBlocks({ on: 1, hideOutline: true, harderSums: false })).toEqual({ on: false, hideOutline: true, harderSums: false });
    expect(cleanBlocks(JSON.parse('{"__proto__": {"on": true}}'))).toEqual({ on: false, hideOutline: false, harderSums: true });
  });
});

describe('tileBlocks', () => {
  it('covers a flat area with the biggest blocks', () => {
    const { width, height, classOf } = classes(['aaaaaa', 'aaaaaa', 'aaaaaa', 'aaaaaa', 'aaaaaa', 'aaaaaa']);
    const blocks = tileBlocks(width, height, classOf, false, 1);
    expect(blocks).toEqual([
      { x: 0, y: 0, w: 3, h: 3 },
      { x: 3, y: 0, w: 3, h: 3 },
      { x: 0, y: 3, w: 3, h: 3 },
      { x: 3, y: 3, w: 3, h: 3 },
    ]);
  });

  it('never crosses a colour edge and leaves blank cells out', () => {
    const { width, height, classOf } = classes(['..aab', '.aaab', 'ccaab', 'cc..b', 'ccccb']);
    for (const hide of [false, true]) {
      for (let seed = 0; seed < 20; seed++) expectValidTiling(width, height, classOf, tileBlocks(width, height, classOf, hide, seed));
    }
  });

  it('is valid on random pictures and on every template', () => {
    const rng = createRng(7);
    for (let n = 0; n < 30; n++) {
      const width = rng.int(1, 20);
      const height = rng.int(1, 20);
      const colours = rng.int(1, 4);
      const classOf = Int32Array.from({ length: width * height }, () => rng.int(-1, colours - 1));
      expectValidTiling(width, height, classOf, tileBlocks(width, height, classOf, n % 2 === 0, n));
    }
    for (const d of TEMPLATES) {
      const classOf = Int32Array.from(d.cells, (id) => (id === d.backgroundId ? -1 : d.palette.findIndex((c) => c.id === id)));
      expectValidTiling(d.width, d.height, classOf, tileBlocks(d.width, d.height, classOf, false, d.puzzle.seed));
    }
  });

  it('halves the sums of the templates, and still saves a lot when hiding the outline', () => {
    let cells = 0;
    let big = 0;
    let mixed = 0;
    for (const d of TEMPLATES) {
      const classOf = Int32Array.from(d.cells, (id) => (id === d.backgroundId ? -1 : d.palette.findIndex((c) => c.id === id)));
      cells += classOf.filter((c) => c >= 0).length;
      big += tileBlocks(d.width, d.height, classOf, false, d.puzzle.seed).length;
      mixed += tileBlocks(d.width, d.height, classOf, true, d.puzzle.seed).length;
    }
    expect(big / cells).toBeLessThan(0.45);
    expect(mixed).toBeGreaterThan(big);
    expect(mixed / cells).toBeLessThan(0.65);
  });

  it('mixes block sizes inside flat areas when hiding the outline', () => {
    const width = 30;
    const classOf = new Int32Array(width * width);
    const big = tileBlocks(width, width, classOf, false, 3);
    const mixed = tileBlocks(width, width, classOf, true, 3);
    expect(new Set(big.map((b) => b.w * b.h))).toEqual(new Set([9]));
    expect(new Set(mixed.map((b) => b.w * b.h)).size).toBeGreaterThanOrEqual(5);
  });

  it('is deterministic, changes with the seed and stays local when one cell changes', () => {
    const rng = createRng(11);
    const width = 24;
    const classOf = Int32Array.from({ length: width * width }, (_, i) => (Math.floor(i / 97) + rng.int(0, 20) === 0 ? 1 : 0));
    const a = tileBlocks(width, width, classOf, true, 5);
    expect(tileBlocks(width, width, classOf, true, 5)).toEqual(a);
    expect(tileBlocks(width, width, classOf, true, 6)).not.toEqual(a);
    const changed = Int32Array.from(classOf);
    const at = 20 * width + 20;
    changed[at] = 2;
    const b = tileBlocks(width, width, changed, true, 5);
    const before = (list: Block[]) => list.filter((blk) => blk.y * width + blk.x < 17 * width);
    expect(before(b)).toEqual(before(a));
  });
});

describe('blockIndex / blockCells', () => {
  it('maps cells to their blocks', () => {
    const blocks = [
      { x: 0, y: 0, w: 2, h: 2 },
      { x: 2, y: 0, w: 1, h: 1 },
    ];
    expect([...blockIndex(3, 6, blocks)]).toEqual([0, 0, 1, 0, 0, -1]);
    expect(blockCells(3, blocks[0])).toEqual([0, 1, 3, 4]);
  });
});

describe('block settings are stored and shared', () => {
  const template = TEMPLATES[0];
  const withBlocks = (blocks: BlockSettings | undefined, simple = false): Design => ({
    ...template,
    puzzle: {
      ...template.puzzle,
      blocks,
      ...(simple && { simple: { on: true, set: 'animals' as const, perColor: 2 as const } }),
    },
  });

  it.each([
    [{ on: true, hideOutline: false, harderSums: true }],
    [{ on: false, hideOutline: true, harderSums: false }],
    [{ on: true, hideOutline: true, harderSums: false }],
  ])('%o survives a share link, both file formats, copies and carried settings', (blocks) => {
    for (const simple of [false, true]) {
      const design = withBlocks(blocks, simple);
      const shared = decodeDesign(encodeDesign(design))!;
      expect(shared.puzzle.blocks).toEqual(blocks);
      expect(shared.puzzle.simple?.on ?? false).toBe(simple);
      expect(parseLibraryFile(libraryToJson([design]))!.designs[0].puzzle.blocks).toEqual(blocks);
      const stored = parseStoredLibrary(storedLibraryToJson([design], []));
      expect(stored.status === 'ok' && stored.designs[0].puzzle.blocks).toEqual(blocks);
      const copy = cloneDesign(design);
      expect(copy.puzzle.blocks).toEqual(blocks);
      expect(copy.puzzle.blocks).not.toBe(design.puzzle.blocks);
      expect(readCarriedSettings(carriedState(design), design)!.puzzle.blocks).toEqual(blocks);
    }
  });

  it('a design that never chose keeps no settings, and the link and progress it always had', () => {
    const design = withBlocks(undefined);
    expect(normalizeDesign(design)!.puzzle).not.toHaveProperty('blocks');
    expect(decodeDesign(encodeDesign(design))!.puzzle).not.toHaveProperty('blocks');
    expect(encodeDesign(design)).toBe(encodeDesign(template));
    // Blocks only group the squares, so progress made with other block settings stays valid.
    expect(progressKey(withBlocks({ on: true, hideOutline: true, harderSums: true }))).toBe(progressKey(design));
  });
});
