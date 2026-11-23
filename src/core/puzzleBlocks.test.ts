import { describe, expect, it } from 'vitest';
import { blockCells, HARD_BLOCK_AREA, type BlockSettings } from './blocks';
import { evaluateExpression, formatExpression, generatePuzzle, isTrivialExpression, puzzleWarnings } from './puzzle';
import { createRng } from './rng';
import { TEMPLATES } from './samples';
import { ALL_OPS, DEFAULT_PRINT, DEFAULT_PUZZLE, type Design, type Expression, type Op, type PuzzleSettings } from './types';

const ON: BlockSettings = { on: true, hideOutline: false, harderSums: true };

/** A picture of flat rectangles (so blocks form), `colors` colours, plus some noise. */
function blobDesign(size: number, colors: number, puzzle: Partial<PuzzleSettings> = {}, seed = 3): Design {
  const palette = Array.from({ length: colors }, (_, i) => ({ id: `c${i}`, name: `Colour ${i}`, hex: '#000000' }));
  const rng = createRng(seed);
  const cells = Array.from({ length: size * size }, (_, i) => {
    const x = i % size;
    const y = Math.floor(i / size);
    const band = (Math.floor(x / 7) + Math.floor(y / 5)) % colors;
    return palette[rng.next() < 0.05 ? rng.int(0, colors - 1) : band].id;
  });
  return {
    id: 'd1',
    name: 'Blocks',
    width: size,
    height: size,
    palette,
    backgroundId: palette[0].id,
    cells,
    puzzle: { ...DEFAULT_PUZZLE, blankBackground: false, blocks: ON, ...puzzle },
    print: DEFAULT_PRINT,
    createdAt: 0,
    updatedAt: 0,
  };
}

function okPuzzle(design: Design) {
  const res = generatePuzzle(design);
  if (!res.ok) throw new Error(`unexpected error ${JSON.stringify(res.error)}`);
  return res;
}

/** Every step of an expression keeps to the limits of a single expression with its op. */
function expectWithinLimits(e: Expression, s: Pick<PuzzleSettings, 'addSubMax' | 'mulDivMax'>) {
  const steps: [Op, number, number][] = [[e.op, e.a, e.b]];
  if (e.op2 !== undefined) steps.push([e.op2, evaluateExpression({ a: e.a, b: e.b, op: e.op }), e.c!]);
  for (const [op, x, y] of steps) {
    expect(Number.isInteger(x) && Number.isInteger(y)).toBe(true);
    expect(y).toBeGreaterThanOrEqual(1);
    if (op === 'add' || op === 'sub') {
      expect(Math.max(x, y, x + (op === 'add' ? y : 0))).toBeLessThanOrEqual(s.addSubMax);
      expect(op === 'sub' ? x - y : x + y).toBeGreaterThanOrEqual(0);
    } else if (op === 'mul') {
      expect(y).toBeLessThanOrEqual(s.mulDivMax);
    } else {
      expect(y).toBeLessThanOrEqual(s.mulDivMax);
      expect(x % y).toBe(0);
      expect(x).toBeLessThanOrEqual(s.mulDivMax * s.mulDivMax);
    }
  }
}

describe('puzzles with blocks', () => {
  it('give every cell of a block the same expression, of its colour', () => {
    for (const legendMode of ['range', 'value'] as const) {
      const design = blobDesign(30, 5, { ops: [...ALL_OPS], addSubMax: 50, legendMode });
      const res = okPuzzle(design);
      expect(res.blocks).toBeDefined();
      const covered = new Set<number>();
      for (const b of res.blocks!) {
        const cells = blockCells(design.width, b);
        const e = res.expressions[cells[0]]!;
        for (const i of cells) {
          expect(res.expressions[i]).toBe(e);
          expect(design.cells[i]).toBe(design.cells[cells[0]]);
          covered.add(i);
        }
        const entry = res.legend.find((l) => l.colorId === design.cells[cells[0]])!;
        expect(evaluateExpression(e)).toBe(e.result);
        if (legendMode === 'range') expect(e.result >= entry.min && e.result <= entry.max).toBe(true);
        else expect(entry.values).toContain(e.result);
      }
      expect(covered.size).toBe(design.cells.length);
      // Far fewer sums than squares.
      expect(res.blocks!.length).toBeLessThan(design.cells.length * 0.4);
    }
  });

  it('leaves blank cells out of blocks', () => {
    const design = blobDesign(30, 4, { blankBackground: true });
    const res = okPuzzle(design);
    for (const b of res.blocks!) for (const i of blockCells(design.width, b)) expect(design.cells[i]).not.toBe(design.backgroundId);
    design.cells.forEach((id, i) => expect(res.expressions[i] === null).toBe(id === design.backgroundId));
  });

  it('are off by default for small grids, so their puzzles stay exactly as before', () => {
    for (const d of TEMPLATES) {
      const res = generatePuzzle(d);
      expect(res.ok && res.blocks).toBeFalsy();
    }
    const small = blobDesign(24, 4, { blocks: undefined });
    const res = generatePuzzle(small);
    expect(res).toEqual(generatePuzzle({ ...small, puzzle: { ...small.puzzle, blocks: { ...ON, on: false } } }));
    expect(res.ok && 'blocks' in res).toBe(false);
  });

  it('are on by default for big grids', () => {
    const res = okPuzzle(blobDesign(32, 4, { blocks: undefined }));
    expect(res.blocks?.length).toBeGreaterThan(0);
  });

  it('change with the seed', () => {
    const design = blobDesign(30, 4, { blocks: { ...ON, hideOutline: true } });
    const a = okPuzzle(design).blocks;
    const b = okPuzzle({ ...design, puzzle: { ...design.puzzle, seed: 99 } }).blocks;
    expect(a).not.toEqual(b);
  });

  it('count blocks, not squares, in the warnings', () => {
    // Sums up to 5 have only 10 different two-number sums.
    const design = blobDesign(30, 3, { ops: ['add'], addSubMax: 5, blocks: { ...ON, harderSums: false } });
    const res = okPuzzle(design);
    const few = puzzleWarnings(design, res).find((w) => w.code === 'fewExpressions');
    expect(few && few.code === 'fewExpressions' && few.cells).toBe(res.blocks!.length);
  });
});

describe('longer sums in big blocks', () => {
  const OP_SETS: Op[][] = [['add'], ['sub'], ['add', 'sub'], ['mul'], ['div'], ['mul', 'div'], [...ALL_OPS]];

  it.each(OP_SETS.map((ops) => [ops.join(' ')]))('are correct, within the limits and of one kind: %s', (opsText) => {
    const ops = opsText.split(' ') as Op[];
    for (const legendMode of ['range', 'value'] as const) {
      const settings = { ops, addSubMax: 50, mulDivMax: 10, legendMode };
      const design = blobDesign(32, 4, settings);
      const res = okPuzzle(design);
      let big = 0;
      let chains = 0;
      for (const b of res.blocks!) {
        const e = res.expressions[b.y * design.width + b.x]!;
        expectWithinLimits(e, settings);
        expect(evaluateExpression(e)).toBe(e.result);
        if (b.w * b.h < HARD_BLOCK_AREA) {
          expect(e.op2).toBeUndefined();
          continue;
        }
        big++;
        if (e.op2 === undefined) continue;
        chains++;
        expect(isTrivialExpression(e)).toBe(false);
        expect(ops).toContain(e.op2);
        expect(['add', 'sub'].includes(e.op)).toBe(['add', 'sub'].includes(e.op2));
      }
      expect(big).toBeGreaterThan(10);
      // Division alone: only quotients with a ÷ ÷ chain within M² (2..M/2 with M = 10) can have one.
      expect(chains).toBeGreaterThanOrEqual(big * (opsText === 'div' ? 0.3 : 0.8));
    }
  });

  it('are left out when switched off', () => {
    const plain = okPuzzle(blobDesign(30, 4, { blocks: { ...ON, harderSums: false } }));
    expect(plain.expressions.every((e) => e?.op2 === undefined)).toBe(true);
  });

  it('format left to right with the chosen signs', () => {
    const e: Expression = { a: 12, b: 7, op: 'add', op2: 'sub', c: 5, result: 14 };
    expect(formatExpression(e, DEFAULT_PRINT)).toBe('12 + 7 − 5');
    expect(formatExpression({ a: 24, b: 4, op: 'div', op2: 'mul', c: 3, result: 18 }, { divSymbol: ':', mulSymbol: '·' })).toBe(
      '24 : 4 · 3',
    );
    expect(evaluateExpression({ a: 24, b: 4, op: 'div', op2: 'mul', c: 3 })).toBe(18);
  });

  it.each([
    [{ a: 7, b: 5, op: 'add', op2: 'sub', c: 5 }, true],
    [{ a: 7, b: 5, op: 'add', op2: 'sub', c: 7 }, true],
    [{ a: 7, b: 5, op: 'sub', op2: 'add', c: 5 }, true],
    [{ a: 7, b: 5, op: 'sub', op2: 'add', c: 7 }, false],
    [{ a: 6, b: 4, op: 'mul', op2: 'div', c: 6 }, true],
    [{ a: 6, b: 4, op: 'mul', op2: 'div', c: 3 }, false],
    [{ a: 12, b: 4, op: 'div', op2: 'mul', c: 4 }, true],
    [{ a: 12, b: 4, op: 'div', op2: 'div', c: 3 }, true],
    [{ a: 7, b: 5, op: 'add', op2: 'add', c: 1 }, false],
  ] as const)('isTrivialExpression(%o) = %s', (e, trivial) => {
    expect(isTrivialExpression(e)).toBe(trivial);
  });

  it('keep a 40 × 40 puzzle fast', () => {
    const design = blobDesign(40, 24, { ops: [...ALL_OPS], addSubMax: 1000, mulDivMax: 20 });
    okPuzzle(design); // warm-up (JIT)
    const t0 = performance.now();
    okPuzzle(design);
    expect(performance.now() - t0).toBeLessThan(250);
  });
});

describe('simple mode with blocks', () => {
  it('puts one symbol in each block and uses every symbol of the key', () => {
    const design = blobDesign(30, 4, { simple: { on: true, set: 'animals', perColor: 3 } });
    const res = okPuzzle(design);
    const shown = new Set<string>();
    for (const b of res.blocks!) {
      const cells = blockCells(design.width, b);
      const symbol = res.symbols![cells[0]];
      expect(symbol).toBeTruthy();
      for (const i of cells) expect(res.symbols![i]).toBe(symbol);
      shown.add(symbol!);
    }
    for (const entry of res.legend) for (const s of entry.symbols ?? []) expect(shown).toContain(s);
  });
});
