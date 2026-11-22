import { describe, expect, it } from 'vitest';
import { decodeDesign, encodeDesign } from './codec';
import { cloneDesign, normalizeDesign } from './design';
import { libraryToJson, parseLibraryFile, parseStoredLibrary, storedLibraryToJson } from './fileio';
import { generatePuzzle, puzzleWarnings } from './puzzle';
import { TEMPLATES } from './samples';
import {
  cleanSimple,
  isPictogram,
  PICTOGRAM_SETS,
  SYMBOL_SETS,
  SYMBOLS_PER_COLOR,
  symbolCapacity,
  type SimpleSettings,
} from './symbols';
import { DEFAULT_PRINT, DEFAULT_PUZZLE, MAX_PALETTE, type Design, type PuzzleSettings } from './types';
import { progressKey } from '../state/progress';

function makeDesign(colors: number, simple: Partial<SimpleSettings> = {}, puzzle: Partial<PuzzleSettings> = {}): Design {
  const palette = Array.from({ length: colors }, (_, i) => ({ id: `c${i}`, name: `Colour ${i}`, hex: '#336699' }));
  return {
    id: 'd1',
    name: 'Test',
    width: 12,
    height: 12,
    palette,
    backgroundId: 'c0',
    cells: Array.from({ length: 144 }, (_, i) => palette[i % colors].id),
    puzzle: { ...DEFAULT_PUZZLE, blankBackground: false, ...puzzle, simple: { on: true, set: 'numbers', perColor: 1, ...simple } },
    print: DEFAULT_PRINT,
    createdAt: 0,
    updatedAt: 0,
  };
}

function solved(design: Design) {
  const result = generatePuzzle(design);
  if (!result.ok) throw new Error(result.error.code);
  return { legend: result.legend, symbols: result.symbols! };
}

/** The rules every simple puzzle must keep. */
function checkPuzzle(design: Design) {
  const { legend, symbols } = solved(design);
  const owner = new Map<string, string>();
  for (const entry of legend) {
    for (const symbol of entry.symbols ?? []) {
      expect(owner.has(symbol), `${symbol} stands for two colours`).toBe(false);
      owner.set(symbol, entry.colorId);
    }
  }
  symbols.forEach((symbol, i) => {
    if (symbol !== null) expect(owner.get(symbol)).toBe(design.cells[i]);
  });
  expect(new Set(symbols.filter((s) => s !== null))).toEqual(new Set(owner.keys()));
}

describe('simple puzzles', () => {
  for (const set of SYMBOL_SETS) {
    it.each(SYMBOLS_PER_COLOR)(`${set}, %i per colour: each symbol is one colour, and every listed one is used`, (perColor) => {
      for (const colors of [1, 2, 5, 9, 12, MAX_PALETTE]) {
        const design = makeDesign(colors, { set, perColor });
        if (colors <= symbolCapacity(set)) checkPuzzle(design);
        else expect(generatePuzzle(design)).toMatchObject({ ok: false, error: { code: 'tooFewSymbols', colorsUsed: colors } });
      }
    });
  }

  it.each(TEMPLATES.map((d) => [d.name, d] as const))('%s works with numbers, letters and mixed pictures', (_name, template) => {
    for (const set of ['numbers', 'upper', 'lower', 'mixed'] as const) {
      checkPuzzle({ ...template, puzzle: { ...template.puzzle, simple: { on: true, set, perColor: 3 } } });
    }
  });

  it('numbers run from 1 without gaps', () => {
    const { symbols } = solved(makeDesign(5, { perColor: 2 }));
    const numbers = [...new Set(symbols)].map(Number).sort((a, b) => a - b);
    expect(numbers).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });

  it('uses a colour’s symbols equally often', () => {
    const { legend, symbols } = solved(makeDesign(4, { set: 'upper', perColor: 3 }));
    for (const entry of legend) {
      const uses = entry.symbols!.map((s) => symbols.filter((x) => x === s).length);
      expect(Math.max(...uses) - Math.min(...uses)).toBeLessThanOrEqual(1);
    }
  });

  it('gives every colour one before any gets more when the set is short', () => {
    const { legend } = solved(makeDesign(9, { set: 'animals', perColor: 4 }));
    const sizes = legend.map((e) => e.symbols!.length);
    expect(Math.min(...sizes)).toBe(1);
    expect(sizes.reduce((a, b) => a + b, 0)).toBe(12);
  });

  it('never promises more symbols than a colour has squares', () => {
    const design = makeDesign(2, { perColor: 4 });
    design.cells = design.cells.map((_, i) => (i < 2 ? 'c1' : 'c0'));
    expect(solved(design).legend.find((e) => e.colorId === 'c1')!.symbols).toHaveLength(2);
  });

  it('keeps look-alike letters off small puzzles', () => {
    for (let seed = 0; seed < 100; seed++) {
      expect(solved(makeDesign(8, { set: 'upper' }, { seed })).symbols.join('')).not.toMatch(/[IOQ]/);
      expect(solved(makeDesign(8, { set: 'lower' }, { seed })).symbols.join('')).not.toMatch(/[ldpq]/);
    }
  });

  it('leaves plain shapes out of mixed pictures', () => {
    const shapes = new Set<string>(PICTOGRAM_SETS.shapes);
    const { symbols } = solved(makeDesign(12, { set: 'mixed', perColor: 4 }));
    expect(symbols.every((s) => s !== null && isPictogram(s) && !shapes.has(s))).toBe(true);
  });

  it('is repeatable, and the dice deals the symbols again', () => {
    const design = makeDesign(6, { set: 'animals' });
    expect(generatePuzzle(design)).toEqual(generatePuzzle(design));
    const other = { ...design, puzzle: { ...design.puzzle, seed: 2 } };
    expect(solved(other).symbols).not.toEqual(solved(design).symbols);
  });

  it('leaves the background empty, with a key entry when it is a real colour', () => {
    const design = makeDesign(3, {}, { blankBackground: true });
    const { legend, symbols } = solved(design);
    symbols.forEach((s, i) => expect(s === null).toBe(design.cells[i] === 'c0'));
    expect(legend.find((e) => e.colorId === 'c0')).toMatchObject({ blank: true });
  });

  it('does not need operations and has no maths warnings', () => {
    const design = makeDesign(4, {}, { ops: [] });
    const result = generatePuzzle(design);
    expect(result.ok).toBe(true);
    expect(puzzleWarnings(design, result)).toEqual([]);
  });
});

describe('simple settings are stored and shared', () => {
  it.each(SYMBOL_SETS)('%s survives a share link and both file formats', (set) => {
    const design = makeDesign(5, { set, perColor: 3 });
    const simple = { on: true, set, perColor: 3 };
    expect(decodeDesign(encodeDesign(design))!.puzzle.simple).toEqual(simple);
    expect(parseLibraryFile(libraryToJson([design]))!.designs[0].puzzle.simple).toEqual(simple);
    const stored = parseStoredLibrary(storedLibraryToJson([design], []));
    expect(stored.status === 'ok' && stored.designs[0].puzzle.simple).toEqual(simple);
  });

  it('a maths design has no simple settings and the link it always had', () => {
    const design = makeDesign(5);
    const maths = { ...design, puzzle: { ...design.puzzle, simple: undefined } };
    const switchedBack = { ...design, puzzle: { ...design.puzzle, simple: { ...design.puzzle.simple!, on: false } } };
    expect(normalizeDesign(maths)!.puzzle).not.toHaveProperty('simple');
    expect(encodeDesign(switchedBack)).toBe(encodeDesign(maths));
    expect(progressKey(switchedBack)).toBe(progressKey(maths));
    expect(progressKey(design)).not.toBe(progressKey(maths));
  });

  it('repairs untrusted settings', () => {
    expect(cleanSimple({ on: 'yes', set: '__proto__', perColor: 99 })).toEqual({ on: false, set: 'numbers', perColor: 1 });
    expect(cleanSimple('simple')).toBeUndefined();
    expect(cleanSimple([])).toBeUndefined();
  });

  it('copies do not share the settings object', () => {
    const design = makeDesign(3);
    expect(cloneDesign(design).puzzle.simple).not.toBe(design.puzzle.simple);
  });
});
