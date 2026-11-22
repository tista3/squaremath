// OWNER: core-puzzle agent. Pure, deterministic puzzle generation.
import { isPaperColor } from './colors';
import { createRng, mixSeed, type Rng } from './rng';
import { assignSymbols, placeSymbols, symbolCapacity, symbolRank, type SimpleSettings } from './symbols';
import {
  ADD_SUB_LIMITS,
  ALL_OPS,
  DEFAULT_PUZZLE,
  MUL_DIV_LIMITS,
  type Design,
  type Expression,
  type LegendEntry,
  type Op,
  type PrintSettings,
  type PuzzleResult,
  type PuzzleSettings,
} from './types';

/*
 * Expression spaces (operands are always ≥ 1, so "+0" and "−0" never occur):
 *   add: a + b,  a+b ≤ N                 → results 2..N
 *   sub: a − b,  1 ≤ b ≤ a ≤ N           → results 0..N−1
 *   mul: a × b,  a,b ∈ 1..M              → products
 *   div: a ÷ b,  b,q ∈ 1..M, a = b·q     → results 1..M
 * "Nice" (non-trivial) expressions avoid ×1, ÷1, x÷x and x−x. Everything is computed per result value,
 * never by enumerating all operand pairs (N can be 1000).
 *
 * Variety model: nicePairCount(op, v) is the number of distinct nice expressions giving v. A colour with
 * n cells "needs" about n / (ops · TARGET_REPEATS) of them per op; the legend is built so that every colour
 * covers that need for as many ops as possible (bigger colours choose first), and each op's nice results
 * are spread over several colours so the operation sign never gives a colour away.
 */

const LEGEND_SALT = 0x1e6e7d;
const CELL_SALT = 0xce11;
const SYMBOL_SALT = 0x5b01;

/** A colour wants enough distinct expressions per op that each one appears about this often. */
const TARGET_REPEATS = 2;
/** Upper bound of that need (per op), so huge colours still compare chunks/values sensibly. */
const MAX_PAIR_NEED = 40;

/** Range mode: weight of plain chunk-size balance next to the per-op balance of nice results. */
const SIZE_WEIGHT = 0.25;
/** Range mode: cap of the cost of a chunk with too many nice results of an op (a chunk without any costs 1). */
const OVERFILL_COST = 0.5;
/** Range mode: cost of a chunk holding every nice result of an op (that op's sign would reveal the colour). */
const CONFINE_COST = 8;
/** Range mode: with more results than this, chunk boundaries are restricted to per-op quantiles. */
const MAX_BOUNDARIES = 240;
/** Range mode: relative random spread when dealing chunks, so only near-equal chunks are swapped by the seed. */
const DEAL_JITTER = 0.15;

/** Value mode: at most this many exact results per colour; one more for every CELLS_PER_EXTRA_VALUE cells. */
export const MAX_VALUES_PER_COLOR = 4;
const CELLS_PER_EXTRA_VALUE = 10;
/** Value mode: weight factor for a number next to another colour's number (held back while others remain). */
const NEIGHBOUR_VALUE_FACTOR = 0.25;
/** Value mode: a candidate's weight is its coverage gain to this power (strongly favours rich results). */
const VALUE_GAIN_POWER = 3;

/** Cells: candidates sampled per op; the lowest penalty wins. */
const SAMPLES_PER_OP = 8;
const TRIVIAL_PENALTY = 8;
const ADJACENT_PENALTY = 4;
/** × log2(1 + uses beyond the op's planned repeats in the colour, OpChoice.repeats): spreads cells evenly over the expressions. */
const USAGE_PENALTY = 1.0;
/** share·cells/supply can land a hair above a whole number (2.0000000000000004); don't round that up. */
const REPEATS_EPSILON = 1e-9;
/**
 * × how far an op is above its fair share so far (ratio − 1, capped at MAX_OP_EXCESS): on the whole sheet, and within
 * the colour (so every colour mixes the ops it can reach). Both together stay below ADJACENT_PENALTY.
 */
const OP_BALANCE_PENALTY = 4;
const COLOR_OP_BALANCE_PENALTY = 1.5;
const MAX_OP_EXCESS = 0.6;
const TIE_JITTER = 0.05;
/** A result's chance to be picked grows with its number of nice expressions, up to this cap. */
const PAIR_WEIGHT_CAP = 12;
/** An op reaching less of the sheet than this is weighted as if it reached this much (see assignOpShares). */
const MIN_REACH = 0.25;
/** Each op keeps at least this share of a colour's cells (see opShares)… */
const MIN_OP_SHARE = 0.15;
/** …unless that would repeat each of its expressions more often than this. */
const MAX_FLOOR_REPEATS = 4;

/** Warnings: thresholds of puzzleWarnings(). */
const WARN_MIN_DISTINCT = 12;
const WARN_CELLS_PER_DISTINCT = 4;
const WARN_TRIVIAL_SHARE = 0.1;
const WARN_MIN_OP_SHARE = 0.1;
const WARN_MIN_CELLS_FOR_SHARES = 20;
const WARN_MIN_OP_CELLS_FOR_REVEAL = 5;
const WARN_MIN_CELLS_FOR_SINGLE_ANSWER = 10;

interface Space {
  ops: Op[];
  addSubMax: number;
  mulDivMax: number;
  /** Indexed by value: 1 if some a×b (a,b ∈ 1..M) gives it. */
  mulAny: Uint8Array;
  /** Indexed by value: 1 if some a×b with a,b ∈ 2..M gives it. */
  mulNice: Uint8Array;
  /** Sorted union of all selected ops' results. */
  results: number[];
}

/** pairs[o][i] = nicePairCount(space.ops[o], space.results[i]). */
type PairTable = Int32Array[];

/** Values of one legend class reachable by one op. */
interface OpChoice {
  op: Op;
  all: number[];
  nice: number[];
  /** Running sums of min(nicePairCount, PAIR_WEIGHT_CAP) over `nice` (weighted value choice). */
  cumulative: Float64Array;
  /** Fraction of the colour's cells this op should get (see opShares); shares of a class sum to 1. */
  share: number;
  /** Number of distinct non-trivial expressions the op has in this colour. */
  supply: number;
  /** Number of distinct trivial expressions (used only when the colour has no non-trivial one at all). */
  trivialSupply: number;
  /** How often each of the op's expressions is expected to appear in the colour (≥ 1); reuse beyond that is penalised. */
  repeats: number;
}

interface ColorClass {
  colorId: string;
  values: number[];
  /** Ops with a non-trivial expression for some value (all reaching ops if there is none). */
  choices: OpChoice[];
}

/** Things worth telling the parent about a generated puzzle (all computed from the result). */
export type PuzzleWarning =
  /** Few different expressions on the whole sheet (limits too small for the number of colours/cells). */
  | { code: 'fewExpressions'; distinct: number; cells: number }
  /** Many cells use ×1, ÷1, x÷x or x−x. */
  | { code: 'manyTrivial'; trivial: number; cells: number }
  /** A colour with many cells whose cells all have the same answer. */
  | { code: 'singleAnswerColor'; colorId: string; cells: number }
  /** A selected op appears in fewer than 10% of the cells. */
  | { code: 'opImbalance'; op: Op; count: number; cells: number }
  /** Every cell with this op has the same colour, so the sign gives the colour away. */
  | { code: 'opRevealsColor'; op: Op; colorId: string };

/** Settings with ops deduplicated (ALL_OPS order) and limits clamped to the allowed ranges. */
export function clampPuzzleSettings(s: PuzzleSettings): PuzzleSettings {
  const ops = Array.isArray(s.ops) ? ALL_OPS.filter((op) => s.ops.includes(op)) : [];
  return {
    ops,
    addSubMax: clampInt(s.addSubMax, ADD_SUB_LIMITS.min, ADD_SUB_LIMITS.max, DEFAULT_PUZZLE.addSubMax),
    mulDivMax: clampInt(s.mulDivMax, MUL_DIV_LIMITS.min, MUL_DIV_LIMITS.max, DEFAULT_PUZZLE.mulDivMax),
    legendMode: s.legendMode === 'value' ? 'value' : 'range',
    seed: Number.isFinite(s.seed) ? Math.trunc(s.seed) >>> 0 : DEFAULT_PUZZLE.seed,
    blankBackground: s.blankBackground !== false,
  };
}

/** Value of `a op b` (division is exact for generated expressions). */
export function evaluateExpression(e: Pick<Expression, 'a' | 'b' | 'op'>): number {
  switch (e.op) {
    case 'add':
      return e.a + e.b;
    case 'sub':
      return e.a - e.b;
    case 'mul':
      return e.a * e.b;
    case 'div':
      return e.a / e.b;
  }
}

/** ×1, 1×, ÷1, x÷x and x−x: expressions a child can answer without calculating. */
export function isTrivialExpression(e: Pick<Expression, 'a' | 'b' | 'op'>): boolean {
  switch (e.op) {
    case 'add':
      return false;
    case 'sub':
      return e.a === e.b;
    case 'mul':
      return e.a === 1 || e.b === 1;
    case 'div':
      return e.b === 1 || e.a === e.b;
  }
}

/** Sorted distinct results achievable with the given ops & limits. */
export function achievableResults(s: PuzzleSettings): number[] {
  return buildSpace(clampPuzzleSettings(s)).results;
}

/** Max number of distinct colours a puzzle can have with these settings. */
export function maxColorsFor(s: PuzzleSettings): number {
  return achievableResults(s).length;
}

/** Generate the puzzle for a design. Deterministic in (design.cells, palette ids, design.puzzle). */
export function generatePuzzle(design: Design): PuzzleResult {
  const settings = clampPuzzleSettings(design.puzzle);
  const { simple } = design.puzzle;
  if (simple?.on) return generateSimplePuzzle(design, settings, simple);
  if (settings.ops.length === 0) return { ok: false, error: { code: 'noOps' } };

  const space = buildSpace(settings);
  const blankId = settings.blankBackground ? design.backgroundId : null;
  const { colorIds, counts, classOf } = collectClasses(design, blankId);
  const k = colorIds.length;
  if (k > space.results.length) {
    return { ok: false, error: { code: 'tooManyColors', colorsUsed: k, resultsAvailable: space.results.length } };
  }
  const blankEntries = blankLegend(design, blankId);
  if (k === 0) return { ok: true, expressions: design.cells.map(() => null), legend: blankEntries };

  const legendRng = createRng(mixSeed(settings.seed, LEGEND_SALT, k, space.results.length));
  const pairs = pairTable(space);
  const valueSets =
    settings.legendMode === 'range'
      ? assignRanges(space, pairs, counts, legendRng)
      : assignValues(space, pairs, counts, legendRng);
  const classes = colorIds.map((colorId, c) => buildClass(space, colorId, valueSets[c]));
  assignOpShares(classes, counts);
  const expressions = generateExpressions(space, design, classes, classOf, settings.seed);

  // Value mode lists exact numbers, so it only lists the ones some cell really produces.
  const used = classes.map(() => new Set<number>());
  expressions.forEach((e, i) => e && used[classOf[i]].add(e.result));
  const legend = classes.map(({ colorId, values }, c): LegendEntry => {
    const shown = settings.legendMode === 'value' ? values.filter((v) => used[c].has(v)) : values;
    return { colorId, min: shown[0], max: shown[shown.length - 1], values: shown };
  });
  return { ok: true, expressions, legend: [...legend, ...blankEntries] };
}

/** Simple mode: the same colour classes and blank background, with a symbol instead of a sum in each cell. */
function generateSimplePuzzle(design: Design, settings: PuzzleSettings, simple: SimpleSettings): PuzzleResult {
  const blankId = settings.blankBackground ? design.backgroundId : null;
  const { colorIds, counts, classOf } = collectClasses(design, blankId);
  const sets = assignSymbols(counts, simple, createRng(mixSeed(settings.seed, SYMBOL_SALT)));
  if (!sets) {
    const symbolsAvailable = symbolCapacity(simple.set);
    return { ok: false, error: { code: 'tooFewSymbols', colorsUsed: colorIds.length, symbolsAvailable } };
  }
  const legend = colorIds.map((colorId, c): LegendEntry => {
    const rank = symbolRank(sets[c][0]);
    return { colorId, min: rank, max: rank, values: [], symbols: sets[c] };
  });
  return {
    ok: true,
    expressions: design.cells.map(() => null),
    symbols: placeSymbols(classOf, sets, mixSeed(settings.seed, SYMBOL_SALT, CELL_SALT)),
    legend: [...legend, ...blankLegend(design, blankId)],
  };
}

/**
 * Legend entry for the blank background: needed only when the background is a real colour (the child must
 * colour the empty boxes); the empty boxes of a paper-white background simply stay as they are.
 */
function blankLegend(design: Design, blankId: string | null): LegendEntry[] {
  if (blankId === null || !design.cells.includes(blankId)) return [];
  const hex = design.palette.find((p) => p.id === blankId)?.hex ?? '#ffffff';
  return isPaperColor(hex) ? [] : [{ colorId: blankId, min: 0, max: 0, values: [], blank: true }];
}

/**
 * Quality warnings for a generated puzzle (empty for a failed or empty one): few different expressions,
 * many trivial ones, a big colour with a single answer, a selected op that hardly appears, or an op whose
 * cells all share one colour. Meant for the puzzle page, with quick fixes such as higher limits or fewer colours.
 */
export function puzzleWarnings(design: Design, result: PuzzleResult): PuzzleWarning[] {
  if (!result.ok) return [];
  // Blank cells have no expression; the indices below refer to the remaining (puzzle) cells.
  const puzzleCells = result.expressions.flatMap((e, i) => (e ? [i] : []));
  if (puzzleCells.length === 0) return [];
  const expressions = puzzleCells.map((i) => result.expressions[i]!);
  const cellColor = puzzleCells.map((i) => design.cells[i]);
  const legend = result.legend.filter((entry) => !entry.blank);
  const cells = expressions.length;
  const ops = clampPuzzleSettings(design.puzzle).ops;
  const warnings: PuzzleWarning[] = [];

  const distinct = new Set(expressions.map(expressionKey)).size;
  if (distinct < Math.min(WARN_MIN_DISTINCT, Math.ceil(cells / WARN_CELLS_PER_DISTINCT))) {
    warnings.push({ code: 'fewExpressions', distinct, cells });
  }
  const trivial = expressions.filter(isTrivialExpression).length;
  if (trivial > cells * WARN_TRIVIAL_SHARE) warnings.push({ code: 'manyTrivial', trivial, cells });
  for (const { colorId } of legend) {
    const answers = new Set<number>();
    let count = 0;
    expressions.forEach((e, i) => {
      if (cellColor[i] !== colorId) return;
      answers.add(e.result);
      count++;
    });
    if (count >= WARN_MIN_CELLS_FOR_SINGLE_ANSWER && answers.size === 1) {
      warnings.push({ code: 'singleAnswerColor', colorId, cells: count });
    }
  }

  if (ops.length < 2) return warnings;
  for (const op of ops) {
    const indices = expressions.flatMap((e, i) => (e.op === op ? [i] : []));
    if (cells >= WARN_MIN_CELLS_FOR_SHARES && indices.length < cells * WARN_MIN_OP_SHARE) {
      warnings.push({ code: 'opImbalance', op, count: indices.length, cells });
    }
    const colors = new Set(indices.map((i) => cellColor[i]));
    if (legend.length >= 2 && indices.length >= WARN_MIN_OP_CELLS_FOR_REVEAL && colors.size === 1) {
      warnings.push({ code: 'opRevealsColor', op, colorId: [...colors][0] });
    }
  }
  return warnings;
}

/** "12 + 7", "15 − 8" (U+2212 minus), "6 × 4" / "6 · 4", "24 ÷ 6" / "24 : 6". No "= ?". */
export function formatExpression(e: Expression, p: Pick<PrintSettings, 'divSymbol' | 'mulSymbol'>): string {
  const symbol = { add: '+', sub: '−', mul: p.mulSymbol, div: p.divSymbol }[e.op];
  return `${e.a} ${symbol} ${e.b}`;
}

/** Shown instead of numbers for a blank legend entry ("colour the empty boxes"); language-neutral. */
export const BLANK_SYMBOL = '□';

/** Range mode: "1–10" (en dash) or "7" when min===max. Value mode: "6, 12, 15". Blank entry: "□". */
export function formatLegendValues(entry: LegendEntry, mode: PuzzleSettings['legendMode']): string {
  if (entry.blank) return BLANK_SYMBOL;
  if (mode === 'value') return entry.values.join(', ');
  return entry.min === entry.max ? `${entry.min}` : `${entry.min}–${entry.max}`;
}

/** Fresh random uint32 seed (crypto / Math.random). */
export function randomSeed(): number {
  const c = globalThis.crypto;
  if (c && typeof c.getRandomValues === 'function') return c.getRandomValues(new Uint32Array(1))[0];
  return Math.floor(Math.random() * 4294967296) >>> 0;
}

// ---------------------------------------------------------------------------------------------
// Expression space

function clampInt(v: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(v)) return fallback;
  return Math.min(max, Math.max(min, Math.round(v)));
}

function buildSpace(s: PuzzleSettings): Space {
  const n = s.addSubMax;
  const m = s.mulDivMax;
  const mulAny = new Uint8Array(m * m + 1);
  const mulNice = new Uint8Array(m * m + 1);
  for (let a = 1; a <= m; a++) {
    for (let b = 1; b <= m; b++) {
      mulAny[a * b] = 1;
      if (a >= 2 && b >= 2) mulNice[a * b] = 1;
    }
  }
  const space: Space = { ops: s.ops, addSubMax: n, mulDivMax: m, mulAny, mulNice, results: [] };
  const top = Math.max(n, m * m);
  for (let v = 0; v <= top; v++) {
    if (space.ops.some((op) => reaches(space, op, v))) space.results.push(v);
  }
  return space;
}

function reaches(space: Space, op: Op, v: number): boolean {
  switch (op) {
    case 'add':
      return v >= 2 && v <= space.addSubMax;
    case 'sub':
      return v >= 0 && v <= space.addSubMax - 1;
    case 'mul':
      return space.mulAny[v] === 1;
    case 'div':
      return v >= 1 && v <= space.mulDivMax;
  }
}

/** True when `v` has at least one non-trivial expression with `op`. */
function isNice(space: Space, op: Op, v: number): boolean {
  switch (op) {
    case 'add':
      return reaches(space, op, v);
    case 'sub':
      return v >= 1 && v <= space.addSubMax - 1;
    case 'mul':
      return space.mulNice[v] === 1;
    case 'div':
      return v >= 2 && v <= space.mulDivMax; // 1 is only b ÷ b
  }
}

/** Number of distinct trivial operand pairs giving `v` (x − x, x ÷ x, 1 × v and v × 1). */
function trivialPairCount(space: Space, op: Op, v: number): number {
  switch (op) {
    case 'add':
      return 0;
    case 'sub':
      return v === 0 ? space.addSubMax : 0;
    case 'mul':
      return v === 1 ? 1 : v <= space.mulDivMax ? 2 : 0;
    case 'div':
      return v === 1 ? space.mulDivMax : 0;
  }
}

/** Number of distinct non-trivial (ordered) operand pairs giving `v`. */
function nicePairCount(space: Space, op: Op, v: number): number {
  if (!isNice(space, op, v)) return 0;
  switch (op) {
    case 'add':
      return v - 1;
    case 'sub':
      return space.addSubMax - v;
    case 'mul':
      return mulFactors(space, v, 2).length;
    case 'div':
      return space.mulDivMax - 1;
  }
}

function pairTable(space: Space): PairTable {
  return space.ops.map((op) => Int32Array.from(space.results, (v) => nicePairCount(space, op, v)));
}

/** Factors a ∈ min..M with v = a·b and b ∈ min..M. */
function mulFactors(space: Space, v: number, min: number): number[] {
  const factors: number[] = [];
  for (let a = min; a <= space.mulDivMax; a++) {
    const b = v / a;
    if (Number.isInteger(b) && b >= min && b <= space.mulDivMax) factors.push(a);
  }
  return factors;
}

/** Uniformly sample operands for `op` giving exactly `v` (non-trivial pairs only when `nice`). */
function sampleOperands(space: Space, op: Op, v: number, nice: boolean, rng: Rng): [number, number] {
  switch (op) {
    case 'add': {
      const a = rng.int(1, v - 1);
      return [a, v - a];
    }
    case 'sub': {
      const b = rng.int(1, space.addSubMax - v);
      return [v + b, b];
    }
    case 'mul': {
      const a = rng.pick(mulFactors(space, v, nice ? 2 : 1));
      return [a, v / a];
    }
    case 'div': {
      const b = rng.int(nice ? 2 : 1, space.mulDivMax);
      return [b * v, b];
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Legend

/**
 * Colour ids that get expressions (palette order; unknown ids appended defensively; `blankId` left out) and
 * the per-cell class index (−1 for blank cells).
 */
function collectClasses(
  design: Design,
  blankId: string | null,
): { colorIds: string[]; counts: number[]; classOf: Int32Array } {
  const used = new Set(design.cells);
  if (blankId !== null) used.delete(blankId);
  const colorIds = design.palette.map((p) => p.id).filter((id) => used.has(id));
  for (const id of used) if (!colorIds.includes(id)) colorIds.push(id);

  const index = new Map(colorIds.map((id, i) => [id, i]));
  const counts = new Array<number>(colorIds.length).fill(0);
  const classOf = new Int32Array(design.cells.length);
  design.cells.forEach((id, i) => {
    const c = index.get(id) ?? -1;
    classOf[i] = c;
    if (c >= 0) counts[c]++;
  });
  return { colorIds, counts, classOf };
}

/** Class indices, most cells first (ties by palette order). */
function colorsBySize(counts: number[]): number[] {
  return counts.map((_, i) => i).sort((a, b) => counts[b] - counts[a] || a - b);
}

/** Distinct nice expressions per op a colour with `cells` cells should have to choose from. */
function pairNeed(cells: number, opCount: number): number {
  return Math.min(MAX_PAIR_NEED, Math.max(1, Math.ceil(cells / (opCount * TARGET_REPEATS))));
}

/** How well per-op expression counts meet a colour's need: one point per op whose need is fully met. */
function coverage(supply: ArrayLike<number>, need: number): number {
  let total = 0;
  for (let o = 0; o < supply.length; o++) total += Math.min(supply[o], need);
  return total / need;
}

/**
 * Range mode: split the sorted results into k contiguous chunks (see partitionBounds), then deal them out:
 * colours with more cells pick first and take the chunk that best covers their need for distinct
 * expressions; the seed only decides between near-equal chunks.
 */
function assignRanges(space: Space, pairs: PairTable, counts: number[], rng: Rng): number[][] {
  const bounds = partitionBounds(space, counts.length);
  const chunks = bounds.slice(0, -1).map((start, i) => {
    const end = bounds[i + 1];
    const supply = pairs.map((p) => p.subarray(start, end).reduce((sum, x) => sum + x, 0));
    return { values: space.results.slice(start, end), supply };
  });

  const sets: number[][] = [];
  for (const c of colorsBySize(counts)) {
    const need = pairNeed(counts[c], space.ops.length);
    let best = 0;
    let bestScore = -Infinity;
    chunks.forEach((chunk, i) => {
      const score = (coverage(chunk.supply, need) + 0.01) * (1 + DEAL_JITTER * rng.next());
      if (score > bestScore) {
        best = i;
        bestScore = score;
      }
    });
    sets[c] = chunks.splice(best, 1)[0].values;
  }
  return sets;
}

/**
 * Returns k+1 chunk boundaries (indices into space.results) from 0 to n, found by dynamic programming.
 * The cost balances, for every op, its nice results across chunks (so each colour can mix the ops and has
 * real calculations), plus a weaker balance of plain chunk sizes. A chunk holding all nice results of an op
 * costs extra, because then that op's sign alone would tell the colour.
 */
function partitionBounds(space: Space, k: number): number[] {
  const u = space.results;
  const n = u.length;
  if (k <= 1) return [0, n];

  // prefix[i] = number of nice results of the op among u[0..i); ops without any nice result are ignored.
  const prefixes: Int32Array[] = [];
  for (const op of space.ops) {
    const prefix = new Int32Array(n + 1);
    for (let i = 0; i < n; i++) prefix[i + 1] = prefix[i] + (isNice(space, op, u[i]) ? 1 : 0);
    if (prefix[n] > 0) prefixes.push(prefix);
  }
  const opWeight = prefixes.length > 0 ? 1 / prefixes.length : 0;
  const idealSize = n / k;
  const chunkCost = (i: number, j: number): number => {
    const d = (j - i - idealSize) / idealSize;
    let cost = SIZE_WEIGHT * d * d;
    for (const prefix of prefixes) {
      const total = prefix[n];
      const ideal = total / k;
      const count = prefix[j] - prefix[i];
      const dev = (count - ideal) / ideal;
      // Missing an op costs 1; overfilling costs at most OVERFILL_COST, so spreading a sparse op (÷) pays off.
      const balance = dev < 0 ? dev * dev : Math.min(OVERFILL_COST, dev * dev);
      cost += opWeight * (balance + (total >= 2 && count === total ? CONFINE_COST : 0));
    }
    return cost;
  };

  const cand = boundaryCandidates(n, prefixes);
  const size = cand.length;
  const best = new Float64Array((k + 1) * size).fill(Infinity);
  const parent = new Int32Array((k + 1) * size);
  best[0] = 0;
  for (let c = 1; c <= k; c++) {
    const prevRow = (c - 1) * size;
    for (let q = c; q <= size - 1 - (k - c); q++) {
      let bestTotal = Infinity;
      let bestP = c - 1;
      for (let p = c - 1; p < q; p++) {
        const prev = best[prevRow + p];
        if (prev >= bestTotal) continue; // costs are ≥ 0, so this split cannot win
        const total = prev + chunkCost(cand[p], cand[q]);
        if (total < bestTotal) {
          bestTotal = total;
          bestP = p;
        }
      }
      best[c * size + q] = bestTotal;
      parent[c * size + q] = bestP;
    }
  }

  const bounds = [n];
  for (let c = k, q = size - 1; c > 0; c--) {
    q = parent[c * size + q];
    bounds.unshift(cand[q]);
  }
  return bounds;
}

/**
 * Possible chunk boundaries: every index for small spaces; otherwise evenly spaced indices plus, for every op,
 * the boundaries at quantiles of its nice results (fine where an op's results are dense, e.g. ÷ near 1..M).
 */
function boundaryCandidates(n: number, prefixes: Int32Array[]): number[] {
  if (n <= MAX_BOUNDARIES) return Array.from({ length: n + 1 }, (_, i) => i);
  const steps = Math.floor(MAX_BOUNDARIES / (prefixes.length + 1));
  const set = new Set<number>([0, n]);
  for (let t = 1; t < steps; t++) set.add(Math.round((t * n) / steps));
  for (const prefix of prefixes) {
    const total = prefix[n];
    let i = 0;
    for (let t = 1; t < steps; t++) {
      const before = Math.floor((t * total) / steps);
      if (before === 0) continue;
      while (prefix[i] < before) i++;
      set.add(i);
    }
  }
  return [...set].sort((a, b) => a - b);
}

/**
 * Value mode: each colour gets 1–MAX_VALUES_PER_COLOR exact results (more for colours with more cells).
 * Colours pick in rounds, biggest first; each pick favours results that add the most distinct expressions
 * for ops the colour still lacks, so every colour mixes the selected ops and big colours get variety.
 * A colour never gets two neighbouring numbers, and numbers next to other colours' numbers are held back.
 */
function assignValues(space: Space, pairs: PairTable, counts: number[], rng: Rng): number[][] {
  const u = space.results;
  const opCount = space.ops.length;
  const perColor = valuesPerColor(counts, u.length);
  const total = perColor.reduce((sum, d) => sum + d, 0);

  // A result without any nice expression is only used by cells with no alternative: skip it while possible.
  const niceIndices = u.flatMap((_, i) => (pairs.some((p) => p[i] > 0) ? [i] : []));
  const candidates = niceIndices.length >= total ? niceIndices : u.map((_, i) => i);
  const owner = new Int32Array(u.length).fill(-1);
  const sets = counts.map((): number[] => []);
  const supply = counts.map(() => new Array<number>(opCount).fill(0));
  const weights = new Float64Array(candidates.length);

  /** Owner of the number one below / above u[i] (−1 if none or not picked). */
  const ownerOf = (i: number, j: number): number => (j >= 0 && j < u.length && Math.abs(u[j] - u[i]) === 1 ? owner[j] : -1);

  const pick = (c: number): number => {
    const need = pairNeed(counts[c], opCount);
    // Relaxation levels: 0 = coverage gain; 1 = value's own coverage; 2 = also next to own numbers; 3 = anything.
    for (let level = 0; level < 4; level++) {
      const before = level === 0 ? supply[c] : supply[c].map(() => 0);
      let sum = 0;
      for (let n = 0; n < candidates.length; n++) {
        const i = candidates[n];
        weights[n] = 0;
        if (owner[i] >= 0) continue;
        const below = ownerOf(i, i - 1);
        const above = ownerOf(i, i + 1);
        if (level < 2 && (below === c || above === c)) continue;
        let score = 1;
        if (level < 3) {
          score = 0;
          // Concave per op: the first expressions of an op the colour lacks count most.
          for (let o = 0; o < opCount; o++) {
            score += Math.sqrt(Math.min(before[o] + pairs[o][i], need) / need) - Math.sqrt(Math.min(before[o], need) / need);
          }
        }
        weights[n] = score ** VALUE_GAIN_POWER * (below >= 0 || above >= 0 ? NEIGHBOUR_VALUE_FACTOR : 1);
        sum += weights[n];
      }
      if (sum > 0) return candidates[weightedIndex(weights, rng.next() * sum)];
    }
    throw new Error('assignValues: no value left'); // unreachable: total ≤ number of results
  };

  for (let round = 0; round < MAX_VALUES_PER_COLOR; round++) {
    for (const c of colorsBySize(counts)) {
      if (perColor[c] <= round) continue;
      const i = pick(c);
      owner[i] = c;
      sets[c].push(i);
      for (let o = 0; o < opCount; o++) supply[c][o] += pairs[o][i];
    }
  }
  return sets.map((indices) => indices.map((i) => u[i]).sort((a, b) => a - b));
}

/** 1 + one per CELLS_PER_EXTRA_VALUE cells (max MAX_VALUES_PER_COLOR); extras go to the biggest colours first while results remain. */
function valuesPerColor(counts: number[], available: number): number[] {
  const wanted = counts.map((cnt) => Math.min(MAX_VALUES_PER_COLOR, cnt, 1 + Math.floor(cnt / CELLS_PER_EXTRA_VALUE)));
  const bySize = colorsBySize(counts);
  const result = counts.map(() => 1);
  let extras = available - counts.length;
  for (let level = 2; level <= MAX_VALUES_PER_COLOR; level++) {
    for (const c of bySize) {
      if (extras > 0 && wanted[c] >= level) {
        result[c]++;
        extras--;
      }
    }
  }
  return result;
}

/** Index whose weight interval contains `target` (zero weights are skipped). */
function weightedIndex(w: ArrayLike<number>, target: number): number {
  let chosen = -1;
  for (let i = 0; i < w.length; i++) {
    if (w[i] === 0) continue;
    chosen = i; // the last positive weight also absorbs floating-point leftovers
    target -= w[i];
    if (target < 0) break;
  }
  return chosen;
}

// ---------------------------------------------------------------------------------------------
// Cells

function buildClass(space: Space, colorId: string, values: number[]): ColorClass {
  const choices = space.ops
    .map((op): OpChoice => {
      const all = values.filter((v) => reaches(space, op, v));
      const nice = all.filter((v) => isNice(space, op, v));
      const cumulative = new Float64Array(nice.length);
      nice.forEach((v, i) => {
        cumulative[i] = (i > 0 ? cumulative[i - 1] : 0) + Math.min(PAIR_WEIGHT_CAP, nicePairCount(space, op, v));
      });
      const supply = nice.reduce((sum, v) => sum + nicePairCount(space, op, v), 0);
      const trivialSupply = all.reduce((sum, v) => sum + trivialPairCount(space, op, v), 0);
      return { op, all, nice, cumulative, supply, trivialSupply, share: 0, repeats: 1 };
    })
    .filter((choice) => choice.all.length > 0);
  const niceChoices = choices.filter((choice) => choice.nice.length > 0);
  return { colorId, values, choices: niceChoices.length > 0 ? niceChoices : choices };
}

/**
 * Decides how each colour's cells are split between its ops (OpChoice.share / repeats). The aim is that every
 * selected op covers about the same part of the sheet: an op only some colours can reach (÷ only gives 1..M, so
 * in range mode it lives in the low colours) is weighted up in those colours by 1 / (part of the sheet it reaches).
 */
function assignOpShares(classes: ColorClass[], counts: number[]): void {
  const total = counts.reduce((sum, n) => sum + n, 0);
  const reach = new Map<Op, number>();
  classes.forEach((cls, c) => {
    for (const ch of cls.choices) reach.set(ch.op, (reach.get(ch.op) ?? 0) + counts[c] / total);
  });
  classes.forEach((cls, c) => {
    const supply = cls.choices.map((ch) => ch.supply);
    const weights = cls.choices.map((ch) => 1 / Math.max(MIN_REACH, reach.get(ch.op)!));
    opShares(supply, weights, counts[c]).forEach((share, i) => {
      const ch = cls.choices[i];
      ch.share = share;
      // An expression's result belongs to exactly one colour, so its usage count is a per-colour count.
      const distinct = ch.supply > 0 ? ch.supply : ch.trivialSupply;
      ch.repeats = Math.max(1, (share * counts[c]) / Math.max(1, distinct));
    });
  });
}

/**
 * Weighted "water filling" of a colour's cells over its ops: op o gets min(cap_o, level · weight_o) cells, with
 * the level chosen so everything adds up. The cap keeps an op with few distinct expressions (e.g. × in the range
 * 1–6: only 2×2, 2×3, 3×2) to about TARGET_REPEATS uses of each; but the cap never goes below MIN_OP_SHARE of the
 * cells (a mix stays a mix) unless that would repeat each of the op's expressions more than MAX_FLOOR_REPEATS
 * times. (An op weighted lower than the others by assignOpShares may still get less than MIN_OP_SHARE.)
 * When even the caps cannot fill the colour, every op keeps that floor and the rest follows the supply, so the
 * remaining expressions repeat equally often.
 */
function opShares(supply: number[], weights: number[], cells: number): number[] {
  const k = supply.length;
  const floor = Math.min(MIN_OP_SHARE, 1 / k) * cells;
  const caps = supply.map((s) => Math.max(s * TARGET_REPEATS, Math.min(floor, s * MAX_FLOOR_REPEATS)));
  const totalCap = caps.reduce((sum, c) => sum + c, 0);
  if (totalCap === 0) return supply.map(() => 1 / k);
  if (totalCap <= cells) return supplyShares(supply, floor, cells);

  // Ops in order of the level at which they hit their cap; those below the final level keep their cap.
  const order = caps.map((_, i) => i).sort((a, b) => caps[a] / weights[a] - caps[b] / weights[b]);
  let remaining = cells;
  let weightLeft = weights.reduce((sum, w) => sum + w, 0);
  let level = 0;
  for (const i of order) {
    level = remaining / weightLeft;
    if (caps[i] >= level * weights[i]) break;
    remaining -= caps[i];
    weightLeft -= weights[i];
  }
  return caps.map((c, i) => Math.min(c, level * weights[i]) / cells);
}

/**
 * Shares when the colour has fewer expressions than it needs: proportional to the supply (equal repetition),
 * except that every op keeps min(floor, MAX_FLOOR_REPEATS · supply) cells. Ops whose proportional part falls
 * below that bound are fixed at it and the rest is split again (at most one pass per op). The bounds sum to at
 * most the colour's cells (they are ≤ the caps), so at least one op with supply stays proportional.
 */
function supplyShares(supply: number[], floor: number, cells: number): number[] {
  const lower = supply.map((s) => Math.min(floor, s * MAX_FLOOR_REPEATS));
  const fixed = supply.map(() => false);
  for (;;) {
    let rest = cells;
    let restSupply = 0;
    supply.forEach((s, i) => {
      if (fixed[i]) rest -= lower[i];
      else restSupply += s;
    });
    const scale = rest / restSupply;
    let changed = false;
    supply.forEach((s, i) => {
      if (!fixed[i] && s * scale < lower[i]) {
        fixed[i] = true;
        changed = true;
      }
    });
    if (!changed) return supply.map((s, i) => (fixed[i] ? lower[i] : s * scale) / cells);
  }
}

/** Running totals while filling the grid (row-major, so generation stays deterministic). */
interface CellState {
  /** expressionKey → how many cells already use it. */
  usage: Map<number, number>;
  /** Cells per op, indexed like ALL_OPS. */
  opCounts: number[];
  /** Expected cells per op so far: the sum of the op's share over every placed cell's colour. */
  opExpected: number[];
  /** The same per colour class. */
  classOpCounts: number[][];
  classPlaced: number[];
}

function generateExpressions(
  space: Space,
  design: Design,
  classes: ColorClass[],
  classOf: Int32Array,
  seed: number,
): (Expression | null)[] {
  const width = design.width > 0 ? design.width : design.cells.length;
  const state: CellState = {
    usage: new Map(),
    opCounts: ALL_OPS.map(() => 0),
    opExpected: ALL_OPS.map(() => 0),
    classOpCounts: classes.map(() => ALL_OPS.map(() => 0)),
    classPlaced: classes.map(() => 0),
  };
  const expressions: (Expression | null)[] = [];
  for (let i = 0; i < design.cells.length; i++) {
    const c = classOf[i];
    if (c < 0) {
      expressions.push(null); // blank background cell
      continue;
    }
    // Row-major order: comparing with the left and upper cell covers every orthogonal pair once.
    const neighbours: Expression[] = [];
    const left = i % width > 0 ? expressions[i - 1] : null;
    const up = i >= width ? expressions[i - width] : null;
    if (left) neighbours.push(left);
    if (up) neighbours.push(up);
    const rng = createRng(mixSeed(seed, CELL_SALT, i));
    const expr = chooseExpression(space, classes[c], c, neighbours, state, rng);
    const key = expressionKey(expr);
    const o = ALL_OPS.indexOf(expr.op);
    state.usage.set(key, (state.usage.get(key) ?? 0) + 1);
    state.opCounts[o]++;
    for (const choice of classes[c].choices) state.opExpected[ALL_OPS.indexOf(choice.op)] += choice.share;
    state.classOpCounts[c][o]++;
    state.classPlaced[c]++;
    expressions.push(expr);
  }
  return expressions;
}

/**
 * Samples a few candidates for every op the class can use (ops in random order, results weighted by their
 * number of nice expressions) and keeps the one with the lowest penalty: trivial ≫ repeats a neighbour >
 * op above its fair share of the sheet / colour ≈ expression already used often. Stops at a perfect one.
 */
function chooseExpression(
  space: Space,
  cls: ColorClass,
  classIndex: number,
  neighbours: Expression[],
  state: CellState,
  rng: Rng,
): Expression {
  const placedInClass = state.classPlaced[classIndex];
  const excess = (count: number, fair: number) => Math.min(MAX_OP_EXCESS, Math.max(0, (count + 1) / (fair + 1) - 1));
  let best: Expression | undefined;
  let bestPenalty = Infinity;
  const first = rng.int(0, cls.choices.length - 1); // random op order: the first perfect candidate wins
  for (let c = 0; c < cls.choices.length && bestPenalty >= TIE_JITTER; c++) {
    const choice = cls.choices[(first + c) % cls.choices.length];
    const o = ALL_OPS.indexOf(choice.op);
    const opPenalty =
      OP_BALANCE_PENALTY * excess(state.opCounts[o], state.opExpected[o]) +
      COLOR_OP_BALANCE_PENALTY * excess(state.classOpCounts[classIndex][o], placedInClass * choice.share);
    const nice = choice.nice.length > 0;
    for (let s = 0; s < SAMPLES_PER_OP && bestPenalty >= TIE_JITTER; s++) {
      const result = nice ? choice.nice[pickCumulative(choice.cumulative, rng)] : rng.pick(choice.all);
      const [a, b] = sampleOperands(space, choice.op, result, nice, rng);
      const expr: Expression = { a, b, op: choice.op, result };
      const uses = state.usage.get(expressionKey(expr)) ?? 0;
      const penalty =
        opPenalty +
        (nice ? 0 : TRIVIAL_PENALTY) +
        (neighbours.some((n) => sameExpression(n, expr)) ? ADJACENT_PENALTY : 0) +
        USAGE_PENALTY * Math.log2(1 + Math.max(0, uses + 1 - Math.ceil(choice.repeats - REPEATS_EPSILON))) +
        TIE_JITTER * rng.next();
      if (penalty < bestPenalty) {
        best = expr;
        bestPenalty = penalty;
      }
    }
  }
  return best!;
}

/** Index i with probability proportional to cumulative[i] − cumulative[i−1] (binary search). */
function pickCumulative(cumulative: Float64Array, rng: Rng): number {
  const target = rng.next() * cumulative[cumulative.length - 1];
  let lo = 0;
  let hi = cumulative.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (cumulative[mid] > target) hi = mid;
    else lo = mid + 1;
  }
  return lo;
}

/** Unique number per (op, a, b); operands stay below 2048 (a ≤ max(N, M²) ≤ 1000). */
function expressionKey(e: Pick<Expression, 'a' | 'b' | 'op'>): number {
  return (ALL_OPS.indexOf(e.op) * 2048 + e.a) * 2048 + e.b;
}

function sameExpression(x: Expression, y: Expression): boolean {
  return x.op === y.op && x.a === y.a && x.b === y.b;
}
