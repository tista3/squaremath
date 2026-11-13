import { describe, expect, it } from 'vitest';
import {
  achievableResults,
  clampPuzzleSettings,
  evaluateExpression,
  formatExpression,
  formatLegendValues,
  generatePuzzle,
  isTrivialExpression,
  MAX_VALUES_PER_COLOR,
  maxColorsFor,
  puzzleWarnings,
  randomSeed,
  type PuzzleWarning,
} from './puzzle';
import { createRng } from './rng';
import { TEMPLATES } from './samples';
import {
  ADD_SUB_LIMITS,
  DEFAULT_PRINT,
  DEFAULT_PUZZLE,
  MUL_DIV_LIMITS,
  type Design,
  type Expression,
  type LegendEntry,
  type Op,
  type PuzzleSettings,
} from './types';

function makeDesign(opts: {
  width: number;
  height: number;
  colors: number;
  puzzle?: Partial<PuzzleSettings>;
  /** cell index → colour index; default: seeded random fill */
  fill?: (i: number) => number;
}): Design {
  const palette = Array.from({ length: opts.colors }, (_, i) => ({ id: `c${i}`, name: `Color ${i}`, hex: '#000000' }));
  const rng = createRng(99);
  const fill = opts.fill ?? (() => rng.int(0, opts.colors - 1));
  const cells = Array.from({ length: opts.width * opts.height }, (_, i) => palette[fill(i)].id);
  return {
    id: 'd1',
    name: 'Test',
    width: opts.width,
    height: opts.height,
    palette,
    backgroundId: palette[0].id,
    cells,
    puzzle: { ...DEFAULT_PUZZLE, ...opts.puzzle },
    print: DEFAULT_PRINT,
    createdAt: 0,
    updatedAt: 0,
  };
}

/** Every colour used at least once (cell i % colors), then random. */
function allColorsDesign(width: number, height: number, colors: number, puzzle?: Partial<PuzzleSettings>): Design {
  const rng = createRng(4242);
  return makeDesign({ width, height, colors, puzzle, fill: (i) => (i < colors ? i : rng.int(0, colors - 1)) });
}

function solved(design: Design) {
  const res = generatePuzzle(design);
  if (!res.ok) throw new Error(`unexpected error ${JSON.stringify(res.error)}`);
  return res;
}

function entryFor(legend: LegendEntry[], value: number, mode: PuzzleSettings['legendMode']): LegendEntry[] {
  return legend.filter((e) => (mode === 'range' ? value >= e.min && value <= e.max : e.values.includes(value)));
}

function checkLimits(e: Expression, s: PuzzleSettings) {
  expect(Number.isInteger(e.a) && Number.isInteger(e.b) && Number.isInteger(e.result)).toBe(true);
  switch (e.op) {
    case 'add':
      expect(e.a).toBeGreaterThanOrEqual(1);
      expect(e.b).toBeGreaterThanOrEqual(1);
      expect(e.a + e.b).toBeLessThanOrEqual(s.addSubMax);
      break;
    case 'sub':
      expect(e.b).toBeGreaterThanOrEqual(1);
      expect(e.b).toBeLessThanOrEqual(e.a);
      expect(e.a).toBeLessThanOrEqual(s.addSubMax);
      break;
    case 'mul':
      for (const x of [e.a, e.b]) {
        expect(x).toBeGreaterThanOrEqual(1);
        expect(x).toBeLessThanOrEqual(s.mulDivMax);
      }
      break;
    case 'div':
      expect(e.b).toBeGreaterThanOrEqual(1);
      expect(e.b).toBeLessThanOrEqual(s.mulDivMax);
      expect(e.result).toBeGreaterThanOrEqual(1);
      expect(e.result).toBeLessThanOrEqual(s.mulDivMax);
      expect(e.a % e.b).toBe(0);
      break;
  }
}

/** Full invariant check of a generated puzzle. */
function checkPuzzle(design: Design) {
  const res = solved(design);
  const s = clampPuzzleSettings(design.puzzle);
  const usedIds = design.palette.map((p) => p.id).filter((id) => design.cells.includes(id));

  expect(res.expressions).toHaveLength(design.cells.length);
  expect(res.legend.map((e) => e.colorId)).toEqual(usedIds);

  // Legend: sorted values within [min,max], min/max = extremes, disjoint sets and (range mode) disjoint intervals.
  const allValues = new Set<number>();
  for (const e of res.legend) {
    expect(e.values.length).toBeGreaterThan(0);
    expect(e.values).toEqual([...e.values].sort((a, b) => a - b));
    expect(e.min).toBe(e.values[0]);
    expect(e.max).toBe(e.values[e.values.length - 1]);
    for (const v of e.values) {
      expect(allValues.has(v)).toBe(false);
      allValues.add(v);
    }
  }
  if (s.legendMode === 'range') {
    const sorted = [...res.legend].sort((a, b) => a.min - b.min);
    for (let i = 1; i < sorted.length; i++) expect(sorted[i].min).toBeGreaterThan(sorted[i - 1].max);
    expect([...allValues].sort((a, b) => a - b)).toEqual(achievableResults(s));
  } else {
    for (const e of res.legend) {
      expect(e.values.length).toBeLessThanOrEqual(MAX_VALUES_PER_COLOR);
      // The legend only lists numbers that some cell of that colour produces.
      for (const v of e.values) {
        expect(res.expressions.some((x, i) => x.result === v && design.cells[i] === e.colorId)).toBe(true);
      }
    }
  }

  res.expressions.forEach((e, i) => {
    expect(s.ops).toContain(e.op);
    expect(evaluateExpression(e)).toBe(e.result);
    checkLimits(e, s);
    const matches = entryFor(res.legend, e.result, s.legendMode);
    expect(matches).toHaveLength(1);
    expect(matches[0].colorId).toBe(design.cells[i]);
  });
  return res;
}

describe('achievableResults / maxColorsFor', () => {
  const s = (ops: Op[], addSubMax = 20, mulDivMax = 10): PuzzleSettings => ({ ...DEFAULT_PUZZLE, ops, addSubMax, mulDivMax });

  it('computes each op space', () => {
    expect(achievableResults(s(['add'], 10))).toEqual([2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(achievableResults(s(['sub'], 10))).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(achievableResults(s(['div'], 10, 5))).toEqual([1, 2, 3, 4, 5]);
    expect(achievableResults(s(['mul'], 10, 4))).toEqual([1, 2, 3, 4, 6, 8, 9, 12, 16]);
    expect(achievableResults(s(['add', 'sub'], 10))).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });

  it('counts distinct products of the 10×10 table', () => {
    expect(maxColorsFor(s(['mul']))).toBe(42);
  });

  it('is 0 without ops and clamps limits', () => {
    expect(maxColorsFor(s([]))).toBe(0);
    expect(achievableResults(s(['add'], 100000))).toHaveLength(ADD_SUB_LIMITS.max - 1);
    expect(achievableResults(s(['add'], 1))).toHaveLength(ADD_SUB_LIMITS.min - 1);
    expect(achievableResults(s(['div'], 20, 99))).toHaveLength(MUL_DIV_LIMITS.max);
    expect(achievableResults(s(['add'], Number.NaN))).toHaveLength(DEFAULT_PUZZLE.addSubMax - 1);
  });

  it('ignores duplicate and unknown ops', () => {
    expect(clampPuzzleSettings(s(['div', 'add', 'add', 'pow' as Op])).ops).toEqual(['add', 'div']);
  });
});

describe('generatePuzzle', () => {
  it('is deterministic', () => {
    const d = allColorsDesign(12, 10, 6, { ops: ['add', 'sub', 'mul', 'div'] });
    expect(generatePuzzle(d)).toEqual(generatePuzzle(structuredClone(d)));
  });

  it('changes with the seed', () => {
    const d = allColorsDesign(12, 10, 6, { ops: ['add', 'sub'] });
    const other = { ...d, puzzle: { ...d.puzzle, seed: 2 } };
    const a = solved(d);
    const b = solved(other);
    expect(a.expressions).not.toEqual(b.expressions);
  });

  it('keeps the legend and the cells before it when one cell changes colour', () => {
    // Cells are filled in reading order and balance ops/variety against earlier cells, so only later cells may change.
    const d = allColorsDesign(10, 10, 4, { ops: ['add', 'sub'], legendMode: 'range' });
    const changed = { ...d, cells: [...d.cells] };
    changed.cells[55] = changed.cells[55] === 'c1' ? 'c2' : 'c1';
    const a = solved(d);
    const b = solved(changed);
    expect(b.legend).toEqual(a.legend);
    expect(b.expressions.slice(0, 55)).toEqual(a.expressions.slice(0, 55));
  });

  const configs: [string, Partial<PuzzleSettings>, number][] = [
    ['add', { ops: ['add'], addSubMax: 20 }, 5],
    ['sub', { ops: ['sub'], addSubMax: 10 }, 8],
    ['mul', { ops: ['mul'], mulDivMax: 10 }, 12],
    ['div', { ops: ['div'], mulDivMax: 10 }, 6],
    ['add+sub big', { ops: ['add', 'sub'], addSubMax: 1000 }, 24],
    ['mul+div', { ops: ['mul', 'div'], mulDivMax: 5 }, 7],
    ['all ops', { ops: ['add', 'sub', 'mul', 'div'], addSubMax: 50, mulDivMax: 12 }, 16],
    ['add+mul small', { ops: ['add', 'mul'], addSubMax: 5, mulDivMax: 2 }, 5],
  ];
  for (const mode of ['range', 'value'] as const) {
    describe(`${mode} mode`, () => {
      it.each(configs)('%s satisfies all invariants', (_name, puzzle, colors) => {
        for (const seed of [1, 2, 3, 123456789]) {
          checkPuzzle(allColorsDesign(15, 12, colors, { ...puzzle, legendMode: mode, seed }));
        }
      });
    });
  }

  it('handles the edge case of using every achievable result', () => {
    for (const legendMode of ['range', 'value'] as const) {
      const res = checkPuzzle(allColorsDesign(6, 6, 9, { ops: ['add'], addSubMax: 10, legendMode }));
      for (const e of res.legend) expect(e.values).toHaveLength(1);
    }
  });

  it('supports a single-colour design', () => {
    for (const legendMode of ['range', 'value'] as const) {
      const d = makeDesign({ width: 5, height: 5, colors: 3, fill: () => 1, puzzle: { legendMode } });
      const res = checkPuzzle(d);
      expect(res.legend).toHaveLength(1);
      expect(res.legend[0].colorId).toBe('c1');
    }
  });

  it('range mode with one colour covers everything', () => {
    const d = makeDesign({ width: 4, height: 4, colors: 1, puzzle: { ops: ['add', 'sub'], addSubMax: 20 } });
    const res = solved(d);
    expect(res.legend[0]).toMatchObject({ min: 0, max: 20 });
  });

  it('range chunks are reasonably fair', () => {
    const d = allColorsDesign(20, 20, 8, { ops: ['add', 'sub'], addSubMax: 100, legendMode: 'range' });
    const sizes = solved(d).legend.map((e) => e.values.length);
    const ideal = 101 / 8;
    for (const size of sizes) {
      expect(size).toBeGreaterThanOrEqual(Math.floor(ideal * 0.7));
      expect(size).toBeLessThanOrEqual(Math.ceil(ideal * 1.3));
    }
  });

  it('value mode gives bigger colours more values and avoids consecutive numbers', () => {
    // Colour 0 dominates, colour 3 has a single cell.
    const d = makeDesign({
      width: 20,
      height: 20,
      colors: 4,
      fill: (i) => (i === 0 ? 3 : i < 40 ? 2 : i < 120 ? 1 : 0),
      puzzle: { ops: ['add', 'sub'], addSubMax: 100, legendMode: 'value' },
    });
    for (let seed = 1; seed <= 20; seed++) {
      const res = checkPuzzle({ ...d, puzzle: { ...d.puzzle, seed } });
      const byId = Object.fromEntries(res.legend.map((e) => [e.colorId, e.values]));
      expect(byId.c0).toHaveLength(MAX_VALUES_PER_COLOR);
      expect(byId.c3).toHaveLength(1);
      for (const values of Object.values(byId)) {
        for (let i = 1; i < values.length; i++) expect(values[i] - values[i - 1]).toBeGreaterThan(1);
      }
    }
  });

  it('value mode is limited by availability', () => {
    const d = allColorsDesign(10, 10, 4, { ops: ['div'], mulDivMax: 5, legendMode: 'value' });
    const res = checkPuzzle(d);
    // 1..5 are achievable, but 1 is only b ÷ b: every colour has a better number, so 1 is never used or listed.
    expect(res.legend.flatMap((e) => e.values).sort((a, b) => a - b)).toEqual([2, 3, 4, 5]);
  });

  it('really mixes all selected ops on a big grid', () => {
    for (const legendMode of ['range', 'value'] as const) {
      const ops: Op[] = ['add', 'sub', 'mul', 'div'];
      const d = allColorsDesign(30, 30, 6, { ops, addSubMax: 20, mulDivMax: 10, legendMode });
      const res = solved(d);
      const counts = Object.fromEntries(ops.map((op) => [op, res.expressions.filter((e) => e.op === op).length]));
      for (const op of ops) expect(counts[op]).toBeGreaterThan(900 / 20);
    }
  });

  it('avoids trivial expressions when alternatives exist', () => {
    for (const legendMode of ['range', 'value'] as const) {
      const d = allColorsDesign(30, 30, 8, { ops: ['add', 'sub', 'mul', 'div'], addSubMax: 100, mulDivMax: 10, legendMode });
      const res = solved(d);
      expect(res.expressions.filter(isTrivialExpression)).toHaveLength(0);
    }
  });

  it('rarely repeats an expression in orthogonally adjacent cells', () => {
    // Large single-colour areas are where repeats would happen.
    const d = makeDesign({ width: 20, height: 20, colors: 2, fill: (i) => (i < 200 ? 0 : 1), puzzle: { ops: ['add'], addSubMax: 20 } });
    const res = solved(d);
    let repeats = 0;
    res.expressions.forEach((e, i) => {
      const right = i % 20 < 19 ? res.expressions[i + 1] : undefined;
      const down = i + 20 < 400 ? res.expressions[i + 20] : undefined;
      for (const n of [right, down]) if (n && n.a === e.a && n.b === e.b && n.op === e.op) repeats++;
    });
    expect(repeats).toBe(0);
  });

  it('reports noOps', () => {
    const d = allColorsDesign(5, 5, 2, { ops: [] });
    expect(generatePuzzle(d)).toEqual({ ok: false, error: { code: 'noOps' } });
  });

  it('reports tooManyColors', () => {
    const d = allColorsDesign(6, 6, 6, { ops: ['div'], mulDivMax: 5 });
    expect(generatePuzzle(d)).toEqual({ ok: false, error: { code: 'tooManyColors', colorsUsed: 6, resultsAvailable: 5 } });
  });

  it('ignores unused palette colours', () => {
    const d = makeDesign({ width: 5, height: 5, colors: 6, fill: (i) => (i % 2 ? 1 : 4) });
    expect(solved(d).legend.map((e) => e.colorId)).toEqual(['c1', 'c4']);
  });

  it('generates a 40×40 grid with 24 colours and addSubMax 1000 in < 100 ms', () => {
    const designs = (['range', 'value'] as const).map((legendMode) =>
      allColorsDesign(40, 40, 24, { ops: ['add', 'sub', 'mul', 'div'], addSubMax: 1000, mulDivMax: 20, legendMode }),
    );
    for (const d of designs) generatePuzzle(d); // warm-up (JIT)
    for (const d of designs) {
      const t0 = performance.now();
      const res = generatePuzzle(d);
      const ms = performance.now() - t0;
      expect(res.ok).toBe(true);
      expect(ms).toBeLessThan(100);
    }
    checkPuzzle(designs[0]);
    checkPuzzle(designs[1]);
  });
});

/** 16×16 picture: ~60% background (c0) around a disc split into blocks of the other colours. */
function pictureDesign(colors: number, puzzle: Partial<PuzzleSettings>, variant = 0): Design {
  const rng = createRng(77 + variant);
  return makeDesign({
    width: 16,
    height: 16,
    colors,
    puzzle,
    fill: (i) => {
      const x = i % 16;
      const y = Math.floor(i / 16);
      if (Math.hypot(x - 8 + variant, y - 8) > 5.6) return 0;
      return 1 + ((Math.floor((x + variant) / 3) + Math.floor(y / 2) * 2 + (rng.next() < 0.1 ? 1 : 0)) % (colors - 1));
    },
  });
}

function opStats(design: Design) {
  const res = solved(design);
  const cells = new Map<Op, number>();
  const colors = new Map<Op, Set<string>>();
  res.expressions.forEach((e, i) => {
    cells.set(e.op, (cells.get(e.op) ?? 0) + 1);
    colors.set(e.op, (colors.get(e.op) ?? new Set()).add(design.cells[i]));
  });
  return { res, share: (op: Op) => (cells.get(op) ?? 0) / res.expressions.length, colors: (op: Op) => colors.get(op)?.size ?? 0 };
}

const ALL: Op[] = ['add', 'sub', 'mul', 'div'];

describe('puzzle quality', () => {
  it('value mode mixes all ops even when addSubMax is much larger than mulDivMax', () => {
    for (const addSubMax of [100, 1000]) {
      for (const colors of [2, 4]) {
        for (let seed = 1; seed <= 10; seed++) {
          const { share } = opStats(pictureDesign(colors, { ops: ALL, addSubMax, mulDivMax: 10, legendMode: 'value', seed }));
          for (const op of ALL) expect(share(op), `${op} N${addSubMax} k${colors} seed ${seed}`).toBeGreaterThanOrEqual(0.1);
        }
      }
    }
  });

  it('range mode mixes all ops and never confines one op to a single colour', () => {
    for (const addSubMax of [20, 100]) {
      for (let colors = 2; colors <= 6; colors++) {
        for (let seed = 1; seed <= 5; seed++) {
          const d = pictureDesign(colors, { ops: ALL, addSubMax, mulDivMax: 10, legendMode: 'range', seed }, seed % 2);
          const { share, colors: colorsOf } = opStats(d);
          for (const op of ALL) {
            const label = `${op} N${addSubMax} k${colors} seed ${seed}`;
            // ÷ results are only 1..10, so ÷ lives in the colours whose range covers them; and an op is not forced
            // into colours where its few expressions would repeat. It must still clear the opImbalance warning (10%).
            expect(share(op), label).toBeGreaterThanOrEqual(0.1);
            expect(colorsOf(op), label).toBeGreaterThanOrEqual(2);
          }
        }
      }
    }
  });

  it('range mode gives the biggest colour a chunk with real variety', () => {
    for (const mulDivMax of [5, 10]) {
      for (let colors = 2; colors <= 8; colors++) {
        for (let seed = 1; seed <= 5; seed++) {
          const d = pictureDesign(colors, { ops: ['mul'], mulDivMax, legendMode: 'range', seed });
          const res = solved(d);
          const background = res.expressions.filter((e, i) => d.cells[i] === 'c0' && !isTrivialExpression(e));
          expect(new Set(background.map((e) => `${e.a}×${e.b}`)).size, `M${mulDivMax} k${colors} seed ${seed}`).toBeGreaterThanOrEqual(3);
        }
      }
    }
  });

  it('spreads expressions instead of repeating a few (× ÷ up to 12, exact numbers)', () => {
    const d = makeDesign({
      width: 20,
      height: 20,
      colors: 7,
      fill: (i) => (i < 200 ? 0 : i >= 380 ? 6 : 1 + (Math.floor(i / 7) % 5)),
      puzzle: { ops: ['mul', 'div'], mulDivMax: 12, legendMode: 'value' },
    });
    for (let seed = 1; seed <= 5; seed++) {
      const res = checkPuzzle({ ...d, puzzle: { ...d.puzzle, seed } });
      const uses = new Map<string, number>();
      for (const e of res.expressions) uses.set(`${e.a}${e.op}${e.b}`, (uses.get(`${e.a}${e.op}${e.b}`) ?? 0) + 1);
      expect(uses.size).toBeGreaterThanOrEqual(100);
      expect(Math.max(...uses.values())).toBeLessThanOrEqual(15);
      // The 20-cell bottom row gets several numbers, not one sum with a single factor pair.
      const bottom = res.legend.find((e) => e.colorId === 'c6')!;
      expect(bottom.values.length).toBeGreaterThanOrEqual(2);
    }
  });

  it('never uses b ÷ b when the colour has another quotient', () => {
    for (const legendMode of ['range', 'value'] as const) {
      const res = checkPuzzle(pictureDesign(2, { ops: ['div'], mulDivMax: 10, legendMode }));
      expect(res.expressions.filter((e) => e.a === e.b)).toHaveLength(0);
    }
  });

  it('value mode only lists numbers that appear on the sheet, even with tiny limits', () => {
    // checkPuzzle asserts that every listed value is used by its colour.
    checkPuzzle(pictureDesign(2, { ops: ['sub'], addSubMax: 5, legendMode: 'value' }));
    checkPuzzle(pictureDesign(4, { ops: ['mul'], mulDivMax: 3, legendMode: 'value' }));
  });

  it('built-in templates give puzzles without warnings', () => {
    for (const t of TEMPLATES) expect(puzzleWarnings(t, generatePuzzle(t)), t.id).toEqual([]);
  });

  /** Per colour: how often its most used expression appears, and how many different expressions it has. */
  function usagePerColor(design: Design) {
    const res = solved(design);
    return res.legend.map(({ colorId }) => {
      const uses = new Map<string, number>();
      res.expressions.forEach((e, i) => {
        if (design.cells[i] !== colorId) return;
        const key = `${e.a}${e.op}${e.b}`;
        uses.set(key, (uses.get(key) ?? 0) + 1);
      });
      const cells = [...uses.values()].reduce((sum, n) => sum + n, 0);
      return { colorId, cells, distinct: uses.size, top: Math.max(...uses.values()) };
    });
  }

  it('does not crowd a colour with the few expressions of a scarce op (× ÷ on a 2-colour picture)', () => {
    // Little star with × ÷ to 10: the low colour's range (e.g. 1–6) only has 2×2, 2×3, 3×2 — those must not
    // fill half of its cells just to balance the ops; ÷ has dozens of expressions there. Exact-number legends
    // have at most a few numbers per colour, so there the check is that repetition is spread evenly.
    const star = TEMPLATES.find((t) => t.id === 'tpl-star')!;
    for (const legendMode of ['range', 'value'] as const) {
      for (let seed = 1; seed <= 5; seed++) {
        const d = { ...star, puzzle: { ...star.puzzle, ops: ['mul', 'div'] as Op[], mulDivMax: 10, legendMode, seed } };
        for (const c of usagePerColor(d)) {
          const label = `${legendMode} seed ${seed} ${c.colorId}`;
          expect(c.top, label).toBeLessThanOrEqual(Math.ceil(c.cells / c.distinct) + 1);
          if (legendMode === 'range') expect(c.top, label).toBeLessThanOrEqual(3);
        }
      }
    }
  });

  it('spreads unavoidable repetition evenly when a colour has few expressions', () => {
    // × ÷ to 5 on big colours: far more cells than expressions, so every expression repeats — but about
    // equally often, not one (2×2) far more than the rest.
    for (const t of TEMPLATES) {
      const d = { ...t, puzzle: { ...t.puzzle, ops: ['mul', 'div'] as Op[], mulDivMax: 5, legendMode: 'range' as const } };
      for (const c of usagePerColor(d)) {
        expect(c.top, `${t.id} ${c.colorId}`).toBeLessThanOrEqual(Math.ceil(c.cells / c.distinct) + 3);
      }
    }
  });
});

describe('isTrivialExpression', () => {
  it.each([
    [{ a: 1, b: 7, op: 'mul' }, true],
    [{ a: 7, b: 1, op: 'mul' }, true],
    [{ a: 7, b: 1, op: 'div' }, true],
    [{ a: 7, b: 7, op: 'div' }, true],
    [{ a: 7, b: 7, op: 'sub' }, true],
    [{ a: 1, b: 1, op: 'add' }, false],
    [{ a: 2, b: 3, op: 'mul' }, false],
    [{ a: 14, b: 7, op: 'div' }, false],
    [{ a: 8, b: 7, op: 'sub' }, false],
  ] as const)('%j → %s', (e, trivial) => {
    expect(isTrivialExpression(e)).toBe(trivial);
  });
});

describe('puzzleWarnings', () => {
  const design = (cells: string[], ops: Op[]): Design => ({
    ...makeDesign({ width: cells.length, height: 1, colors: 2, puzzle: { ops } }),
    cells,
  });
  const expr = (a: number, op: Op, b: number): Expression => ({ a, b, op, result: evaluateExpression({ a, b, op }) });
  const result = (expressions: Expression[], colorIds: string[]) => ({
    ok: true as const,
    expressions,
    legend: colorIds.map((colorId) => ({ colorId, min: 0, max: 0, values: [0] })),
  });
  const codes = (w: PuzzleWarning[]) => w.map((x) => x.code);

  it('is empty for failed, empty and healthy puzzles', () => {
    const d = pictureDesign(4, { ops: ['add', 'sub'], addSubMax: 20 });
    expect(puzzleWarnings(d, { ok: false, error: { code: 'noOps' } })).toEqual([]);
    expect(puzzleWarnings(d, { ok: true, expressions: [], legend: [] })).toEqual([]);
    for (const legendMode of ['range', 'value'] as const) {
      const healthy = pictureDesign(5, { ops: ALL, addSubMax: 20, mulDivMax: 10, legendMode });
      expect(puzzleWarnings(healthy, generatePuzzle(healthy))).toEqual([]);
    }
  });

  it('flags few expressions, trivial ones and single-answer colours', () => {
    const cells = Array.from({ length: 40 }, (_, i) => (i < 20 ? 'c0' : 'c1'));
    const expressions = cells.map((c, i) => (c === 'c0' ? expr(i % 2 ? 2 : 1, 'mul', i % 2 ? 2 : 4) : expr(4, 'mul', 1)));
    const warnings = puzzleWarnings(design(cells, ['mul']), result(expressions, ['c0', 'c1']));
    expect(warnings).toEqual([
      { code: 'fewExpressions', distinct: 3, cells: 40 },
      { code: 'manyTrivial', trivial: 30, cells: 40 },
      { code: 'singleAnswerColor', colorId: 'c0', cells: 20 },
      { code: 'singleAnswerColor', colorId: 'c1', cells: 20 },
    ]);
  });

  it('flags a rare op and an op whose cells all share one colour', () => {
    const cells = Array.from({ length: 40 }, (_, i) => (i < 20 ? 'c0' : 'c1'));
    // 5 ÷ cells (12.5%), all in c1; × never used.
    const expressions = cells.map((c, i) => (c === 'c1' && i % 4 === 0 ? expr(2 * i, 'div', 2) : expr(1 + i, 'add', 1 + (i % 5))));
    const warnings = puzzleWarnings(design(cells, ['add', 'mul', 'div']), result(expressions, ['c0', 'c1']));
    expect(codes(warnings)).toEqual(['opImbalance', 'opRevealsColor']);
    expect(warnings).toContainEqual({ code: 'opImbalance', op: 'mul', count: 0, cells: 40 });
    expect(warnings).toContainEqual({ code: 'opRevealsColor', op: 'div', colorId: 'c1' });
  });

  it('flags degenerate settings on real puzzles', () => {
    const divTwo = pictureDesign(2, { ops: ['div'], mulDivMax: 2 });
    expect(codes(puzzleWarnings(divTwo, generatePuzzle(divTwo)))).toEqual(expect.arrayContaining(['fewExpressions', 'manyTrivial']));
    const addFive = pictureDesign(4, { ops: ['add'], addSubMax: 5 });
    expect(codes(puzzleWarnings(addFive, generatePuzzle(addFive)))).toEqual(expect.arrayContaining(['fewExpressions', 'singleAnswerColor']));
  });
});

describe('formatters', () => {
  const p = { divSymbol: '÷', mulSymbol: '×' } as const;
  const q = { divSymbol: ':', mulSymbol: '·' } as const;

  it('formats expressions', () => {
    expect(formatExpression({ a: 12, b: 7, op: 'add', result: 19 }, p)).toBe('12 + 7');
    expect(formatExpression({ a: 15, b: 8, op: 'sub', result: 7 }, p)).toBe('15 − 8');
    expect(formatExpression({ a: 6, b: 4, op: 'mul', result: 24 }, p)).toBe('6 × 4');
    expect(formatExpression({ a: 6, b: 4, op: 'mul', result: 24 }, q)).toBe('6 · 4');
    expect(formatExpression({ a: 24, b: 6, op: 'div', result: 4 }, p)).toBe('24 ÷ 6');
    expect(formatExpression({ a: 24, b: 6, op: 'div', result: 4 }, q)).toBe('24 : 6');
  });

  it('formats legend values', () => {
    const entry = { colorId: 'x', min: 1, max: 10, values: [1, 5, 10] };
    expect(formatLegendValues(entry, 'range')).toBe('1–10');
    expect(formatLegendValues({ ...entry, min: 7, max: 7, values: [7] }, 'range')).toBe('7');
    expect(formatLegendValues({ colorId: 'x', min: 6, max: 15, values: [6, 12, 15] }, 'value')).toBe('6, 12, 15');
  });
});

describe('randomSeed', () => {
  it('returns varying uint32 values', () => {
    const seeds = new Set(Array.from({ length: 20 }, () => randomSeed()));
    expect(seeds.size).toBeGreaterThan(15);
    for (const s of seeds) {
      expect(Number.isInteger(s)).toBe(true);
      expect(s).toBeGreaterThanOrEqual(0);
      expect(s).toBeLessThan(2 ** 32);
    }
  });
});
