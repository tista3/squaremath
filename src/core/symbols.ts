// Simple mode: every square shows a symbol (number, letter or pictogram) and the key says its colour.
// This file only knows the symbol ids; the drawings live in render/pictograms.ts.
import { createRng, mixSeed, type Rng } from './rng';

/** Pictogram themes. Ids are stored nowhere, but their order decides what a seed generates: append only. */
export const PICTOGRAM_SETS = {
  shapes: ['circle', 'square', 'triangle', 'star', 'heart', 'diamond', 'plus', 'hexagon', 'arrow', 'zigzag', 'target', 'arch'],
  animals: ['cat', 'dog', 'rabbit', 'bear', 'pig', 'owl', 'fish', 'bird', 'butterfly', 'snail', 'turtle', 'spider'],
  nature: ['sun', 'moon', 'cloud', 'rainbow', 'drop', 'snowflake', 'flower', 'tree', 'leaf', 'mushroom', 'lightning', 'mountain'],
  food: ['apple', 'pear', 'cherries', 'banana', 'carrot', 'strawberry', 'icecream', 'cupcake', 'pizza', 'sweet', 'cheese', 'egg'],
  vehicles: ['car', 'bus', 'train', 'plane', 'boat', 'rocket', 'bicycle', 'tractor', 'balloon', 'helicopter', 'truck', 'submarine'],
} as const;

type Theme = keyof typeof PICTOGRAM_SETS;
export type PictogramId = (typeof PICTOGRAM_SETS)[Theme][number];

/** The order is used by share links: append only. */
export const SYMBOL_SETS = ['numbers', 'upper', 'lower', 'shapes', 'animals', 'nature', 'food', 'vehicles', 'mixed'] as const;
export type SymbolSet = (typeof SYMBOL_SETS)[number];

/** How many different symbols may stand for the same colour. */
export const SYMBOLS_PER_COLOR = [1, 2, 3, 4] as const;
export type SymbolsPerColor = (typeof SYMBOLS_PER_COLOR)[number];

export interface SimpleSettings {
  /** False keeps the choices below while the design uses maths. */
  on: boolean;
  set: SymbolSet;
  perColor: SymbolsPerColor;
}

export const DEFAULT_SIMPLE: SimpleSettings = { on: false, set: 'numbers', perColor: 1 };

const ALL_PICTOGRAMS: readonly PictogramId[] = Object.values(PICTOGRAM_SETS).flat();
/** 'mixed' leaves the plain shapes out: next to pictures they get confused (arch / rainbow, target / egg). */
const MIXED: readonly PictogramId[] = Object.entries(PICTOGRAM_SETS).flatMap(([theme, ids]) => (theme === 'shapes' ? [] : [...ids]));
const PICTOGRAMS: ReadonlySet<string> = new Set(ALL_PICTOGRAMS);

export function isPictogram(symbol: string): symbol is PictogramId {
  return PICTOGRAMS.has(symbol);
}

/**
 * Pools of symbols, most readable first: a later pool is only used when the earlier ones are used up, so
 * look-alikes (I and l, O and Q, b d p q) stay off small puzzles.
 */
const LETTER_POOLS = {
  upper: ['ABCDEFGHKMPRST', 'JLNUXYZ', 'IOQVW'],
  lower: ['abcefghkmrst', 'jnoxyz', 'dipuvw', 'lq'],
} as const;

/** Simple settings from untrusted data; undefined when there are none. */
export function cleanSimple(raw: unknown): SimpleSettings | undefined {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return undefined;
  const own = (key: keyof SimpleSettings): unknown => (Object.hasOwn(raw, key) ? (raw as Record<string, unknown>)[key] : undefined);
  return {
    on: own('on') === true,
    set: SYMBOL_SETS.find((set) => set === own('set')) ?? DEFAULT_SIMPLE.set,
    perColor: SYMBOLS_PER_COLOR.find((n) => n === own('perColor')) ?? DEFAULT_SIMPLE.perColor,
  };
}

/** Number of different symbols in a set (numbers never run out). */
export function symbolCapacity(set: SymbolSet): number {
  switch (set) {
    case 'numbers':
      return Infinity;
    case 'upper':
    case 'lower':
      return LETTER_POOLS[set].join('').length;
    case 'mixed':
      return MIXED.length;
    default:
      return PICTOGRAM_SETS[set].length;
  }
}

/** Reading order for the key: 1 2 3…, a b c…, or the order of the pictogram list. */
export function symbolRank(symbol: string): number {
  if (isPictogram(symbol)) return ALL_PICTOGRAMS.indexOf(symbol);
  return /^\d+$/.test(symbol) ? Number(symbol) : (symbol.codePointAt(0) ?? 0);
}

function chooseSymbols(set: SymbolSet, count: number, rng: Rng): string[] {
  if (set === 'numbers') return rng.shuffle(Array.from({ length: count }, (_, i) => String(i + 1)));
  const pools: string[][] =
    set === 'upper' || set === 'lower'
      ? LETTER_POOLS[set].map((pool) => [...pool])
      : [set === 'mixed' ? [...MIXED] : [...PICTOGRAM_SETS[set]]];
  const chosen = pools.flatMap((pool) => rng.shuffle(pool)).slice(0, count);
  return rng.shuffle(chosen);
}

/**
 * Symbols for each colour (`counts` = its squares): `perColor` each, but never more than it has squares.
 * When the set is too small every colour still gets one and the bigger colours share the rest.
 * Null when the set cannot even give one to each colour.
 */
export function assignSymbols(counts: readonly number[], { set, perColor }: SimpleSettings, rng: Rng): string[][] | null {
  const capacity = symbolCapacity(set);
  if (counts.length > capacity) return null;
  const bySize = counts.map((_, i) => i).sort((a, b) => counts[b] - counts[a] || a - b);
  const wanted = counts.map(() => 1);
  let total = counts.length;
  for (let level = 2; level <= perColor; level++) {
    for (const c of bySize) {
      if (total >= capacity || counts[c] < level) continue;
      wanted[c]++;
      total++;
    }
  }
  const pool = chooseSymbols(set, total, rng);
  return wanted.map((n) => pool.splice(0, n).sort((a, b) => symbolRank(a) - symbolRank(b)));
}

/**
 * One symbol per square (`classOf` = colour index, −1 for an empty square). A colour's symbols are used
 * equally often, so each one listed in the key really is on the sheet.
 */
export function placeSymbols(classOf: ArrayLike<number>, sets: readonly string[][], seed: number): (string | null)[] {
  const decks = sets.map((symbols, c) => {
    const rng = createRng(mixSeed(seed, c));
    let deck: string[] = [];
    return () => {
      if (deck.length === 0) deck = rng.shuffle([...symbols]);
      return deck.pop()!;
    };
  });
  return Array.from(classOf, (c) => (c < 0 ? null : decks[c]()));
}
