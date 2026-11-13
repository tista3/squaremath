import { describe, expect, it } from 'vitest';
import { DEFAULT_PRINT, DEFAULT_PUZZLE, type PuzzleSettings } from '../../core/types';
import { carriedState, clampLimit, quickFixes, readCarriedSettings, toggleOp } from './settings';

describe('toggleOp', () => {
  it('adds and removes ops in canonical order', () => {
    expect(toggleOp(['sub'], 'add')).toEqual(['add', 'sub']);
    expect(toggleOp(['add', 'div'], 'mul')).toEqual(['add', 'mul', 'div']);
    expect(toggleOp(['add', 'sub'], 'add')).toEqual(['sub']);
  });

  it('never removes the last op', () => {
    expect(toggleOp(['mul'], 'mul')).toEqual(['mul']);
  });
});

describe('clampLimit', () => {
  const limits = { min: 5, max: 1000 };
  it('rounds and clamps', () => {
    expect(clampLimit(3, limits, 20)).toBe(5);
    expect(clampLimit(5000, limits, 20)).toBe(1000);
    expect(clampLimit(42.6, limits, 20)).toBe(43);
  });
  it('falls back on non-numbers', () => {
    expect(clampLimit(Number('abc'), limits, 20)).toBe(20);
  });
});

describe('quickFixes', () => {
  // Fake capacity model: add/sub give addSubMax answers, mul/div give mulDivMax answers.
  const capacity = (s: PuzzleSettings) =>
    (s.ops.some((o) => o === 'add' || o === 'sub') ? s.addSubMax : 0) +
    (s.ops.some((o) => o === 'mul' || o === 'div') ? s.mulDivMax : 0);

  it('suggests the smallest sufficient limits and all ops', () => {
    const s: PuzzleSettings = { ...DEFAULT_PUZZLE, ops: ['add', 'mul'], addSubMax: 10, mulDivMax: 5 };
    const fixes = quickFixes(s, 30, capacity);
    expect(fixes.map((f) => f.kind)).toEqual(['addSubMax', 'mulDivMax', 'allOps']);
    expect(fixes[0]).toMatchObject({ value: 50, settings: { addSubMax: 50 } });
    expect(fixes[1]).toMatchObject({ value: 20, settings: { mulDivMax: 20 } });
  });

  it('omits fixes that cannot help', () => {
    const s: PuzzleSettings = { ...DEFAULT_PUZZLE, ops: ['div'], mulDivMax: 10 };
    const fixes = quickFixes(s, 24, capacity);
    expect(fixes.map((f) => f.kind)).toEqual(['allOps']);
    expect(fixes[0].settings.ops).toEqual(['add', 'sub', 'mul', 'div']);
  });

  it('raises limits together with all ops when needed', () => {
    const s: PuzzleSettings = { ...DEFAULT_PUZZLE, ops: ['div'], addSubMax: 5, mulDivMax: 2 };
    const [fix] = quickFixes(s, 100, capacity);
    expect(fix).toMatchObject({ kind: 'allOps', settings: { addSubMax: 1000, mulDivMax: 20 } });
  });
});

describe('carried settings', () => {
  const fallback = { puzzle: DEFAULT_PUZZLE, print: DEFAULT_PRINT };

  it('round-trips through router state', () => {
    const settings = {
      puzzle: { ...DEFAULT_PUZZLE, ops: ['mul' as const], seed: 77, legendMode: 'value' as const },
      print: { ...DEFAULT_PRINT, divSymbol: ':' as const, includeSolution: true },
    };
    expect(readCarriedSettings(carriedState(settings), fallback)).toEqual(settings);
  });

  it('returns null without carried settings', () => {
    expect(readCarriedSettings(null, fallback)).toBeNull();
    expect(readCarriedSettings({ other: 1 }, fallback)).toBeNull();
  });

  it('repairs invalid fields from the fallback', () => {
    const state = {
      squaremathSettings: { puzzle: { ops: ['pow'], addSubMax: 99999, legendMode: 'x' }, print: { paper: 'A3' } },
    };
    const out = readCarriedSettings(state, fallback)!;
    expect(out.puzzle).toEqual({ ...DEFAULT_PUZZLE, addSubMax: 1000 });
    expect(out.print).toEqual(DEFAULT_PRINT);
  });
});
