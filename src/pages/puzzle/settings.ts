// Pure helpers for the puzzle settings UI (presets, op toggling, quick fixes, sanitising carried settings).
import { cleanBlocks } from '../../core/blocks';
import { cleanSimple, symbolCapacity, type SimpleSettings, type SymbolSet } from '../../core/symbols';
import {
  ADD_SUB_LIMITS,
  ALL_OPS,
  MUL_DIV_LIMITS,
  type Op,
  type PrintSettings,
  type PuzzleSettings,
} from '../../core/types';

export const ADD_SUB_PRESETS = [10, 20, 50, 100, 1000] as const;
export const MUL_DIV_PRESETS = [5, 10, 12] as const;

export type Limits = { readonly min: number; readonly max: number };

/** Puzzle-relevant part of a design; what read-only shared pages keep locally. */
export interface SheetSettings {
  puzzle: PuzzleSettings;
  print: PrintSettings;
}

/** Toggles an op, keeping canonical order; the last remaining op cannot be switched off. */
export function toggleOp(ops: readonly Op[], op: Op): Op[] {
  const on = new Set(ops);
  if (on.has(op)) {
    if (on.size === 1) return [...ops];
    on.delete(op);
  } else {
    on.add(op);
  }
  return ALL_OPS.filter((o) => on.has(o));
}

export function usesAddSub(ops: readonly Op[]): boolean {
  return ops.includes('add') || ops.includes('sub');
}

export function usesMulDiv(ops: readonly Op[]): boolean {
  return ops.includes('mul') || ops.includes('div');
}

/** Rounds and clamps a user-typed limit; non-numbers fall back to `fallback`. */
export function clampLimit(value: number, limits: Limits, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(limits.max, Math.max(limits.min, Math.round(value)));
}

export type QuickFix =
  | { kind: 'addSubMax'; value: number; settings: PuzzleSettings }
  | { kind: 'mulDivMax'; value: number; settings: PuzzleSettings }
  | { kind: 'allOps'; settings: PuzzleSettings };

/**
 * Setting changes that would give at least `colorsNeeded` distinct answers, smallest change first.
 * `maxColors` is injected (core/puzzle maxColorsFor) to keep this pure and testable.
 */
export function quickFixes(
  s: PuzzleSettings,
  colorsNeeded: number,
  maxColors: (s: PuzzleSettings) => number,
): QuickFix[] {
  const enough = (candidate: PuzzleSettings) => maxColors(candidate) >= colorsNeeded;
  const fixes: QuickFix[] = [];

  if (usesAddSub(s.ops)) {
    const candidates = [...ADD_SUB_PRESETS, ADD_SUB_LIMITS.max].filter((v) => v > s.addSubMax);
    const value = candidates.find((v) => enough({ ...s, addSubMax: v }));
    if (value !== undefined) fixes.push({ kind: 'addSubMax', value, settings: { ...s, addSubMax: value } });
  }
  if (usesMulDiv(s.ops)) {
    const candidates = range(s.mulDivMax + 1, MUL_DIV_LIMITS.max);
    const value = candidates.find((v) => enough({ ...s, mulDivMax: v }));
    if (value !== undefined) fixes.push({ kind: 'mulDivMax', value, settings: { ...s, mulDivMax: value } });
  }
  if (s.ops.length < ALL_OPS.length) {
    const allOps = { ...s, ops: [...ALL_OPS] };
    const maxed = { ...allOps, addSubMax: ADD_SUB_LIMITS.max, mulDivMax: MUL_DIV_LIMITS.max };
    if (enough(allOps)) fixes.push({ kind: 'allOps', settings: allOps });
    else if (enough(maxed)) fixes.push({ kind: 'allOps', settings: maxed });
  }
  return fixes;
}

/** Sets to offer when `set` cannot give `needed` symbols: a bigger one of the same kind first, then numbers. */
export function biggerSets({ set }: SimpleSettings, needed: number): SymbolSet[] {
  const pictures = set !== 'upper' && set !== 'lower';
  const candidates: SymbolSet[] = pictures ? ['mixed', 'numbers'] : ['numbers'];
  return candidates.filter((s) => s !== set && symbolCapacity(s) >= needed);
}

function range(from: number, to: number): number[] {
  const out: number[] = [];
  for (let v = from; v <= to; v++) out.push(v);
  return out;
}

function oneOf<T>(value: unknown, allowed: readonly T[], fallback: T): T {
  return allowed.includes(value as T) ? (value as T) : fallback;
}

function boolOr(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function sanitizePuzzle(raw: Record<string, unknown>, fallback: PuzzleSettings): PuzzleSettings {
  const ops = Array.isArray(raw.ops) ? ALL_OPS.filter((o) => (raw.ops as unknown[]).includes(o)) : [];
  const simple = cleanSimple(raw.simple) ?? fallback.simple;
  const blocks = cleanBlocks(raw.blocks) ?? fallback.blocks;
  const seed = typeof raw.seed === 'number' && Number.isFinite(raw.seed) ? raw.seed >>> 0 : fallback.seed;
  return {
    ops: ops.length ? ops : fallback.ops,
    addSubMax: clampLimit(Number(raw.addSubMax), ADD_SUB_LIMITS, fallback.addSubMax),
    mulDivMax: clampLimit(Number(raw.mulDivMax), MUL_DIV_LIMITS, fallback.mulDivMax),
    legendMode: oneOf(raw.legendMode, ['range', 'value'] as const, fallback.legendMode),
    seed,
    blankBackground: boolOr(raw.blankBackground, fallback.blankBackground),
    ...(simple && { simple }),
    ...(blocks && { blocks }),
  };
}

function sanitizePrint(raw: Record<string, unknown>, fallback: PrintSettings): PrintSettings {
  return {
    paper: oneOf(raw.paper, ['A4', 'Letter'] as const, fallback.paper),
    orientation: oneOf(raw.orientation, ['auto', 'portrait', 'landscape'] as const, fallback.orientation),
    divSymbol: oneOf(raw.divSymbol, ['÷', ':'] as const, fallback.divSymbol),
    mulSymbol: oneOf(raw.mulSymbol, ['×', '·'] as const, fallback.mulSymbol),
    showTitle: boolOr(raw.showTitle, fallback.showTitle),
    includeSolution: boolOr(raw.includeSolution, fallback.includeSolution),
    legendSwatches: boolOr(raw.legendSwatches, fallback.legendSwatches),
  };
}

const CARRIED_STATE_KEY = 'squaremathSettings';

/** Router location state that carries settings to a sibling page or to a freshly saved copy. */
export function carriedState(s: SheetSettings): Record<string, SheetSettings> {
  return { [CARRIED_STATE_KEY]: { puzzle: s.puzzle, print: s.print } };
}

/** Reads settings from router location state (untrusted shape); null when none were carried. */
export function readCarriedSettings(state: unknown, fallback: SheetSettings): SheetSettings | null {
  if (!state || typeof state !== 'object') return null;
  const carried = (state as Record<string, unknown>)[CARRIED_STATE_KEY];
  if (!carried || typeof carried !== 'object') return null;
  const { puzzle, print } = carried as Record<string, unknown>;
  return {
    puzzle: sanitizePuzzle(asRecord(puzzle), fallback.puzzle),
    print: sanitizePrint(asRecord(print), fallback.print),
  };
}

function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' ? (v as Record<string, unknown>) : {};
}
