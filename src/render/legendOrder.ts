// OWNER: render-export agent. Display order of legend entries, shared by the printed key and on-screen keys.
import type { LegendEntry, PuzzleSettings } from '../core/types';

/** Smallest result that maps to the entry (range: min, value: first of the sorted values). */
function smallestResult(entry: LegendEntry, mode: PuzzleSettings['legendMode']): number {
  return mode === 'value' && entry.values.length > 0 ? Math.min(...entry.values) : entry.min;
}

/**
 * Legend entries sorted by number (ranges are disjoint, so this is the natural reading order) so a child
 * can find the answer without scanning every entry. Returns a new array; the puzzle's own legend keeps
 * palette order, which keeps seeds and stored data stable. Ties keep their original order.
 */
export function sortLegendForDisplay(legend: readonly LegendEntry[], mode: PuzzleSettings['legendMode']): LegendEntry[] {
  return [...legend].sort((a, b) => smallestResult(a, mode) - smallestResult(b, mode));
}

const nameKey = (name: string) => name.trim().toLocaleLowerCase();

/**
 * Names made unambiguous for a black & white key: names that occur more than once (ignoring case and
 * surrounding spaces) get " (1)", " (2)" … in order of appearance; unique names stay as they are.
 * Call it in palette/legend order (before sorting) so "Blue (1)" means the same colour everywhere.
 */
export function distinctNames(names: readonly string[]): string[] {
  const counts = new Map<string, number>();
  for (const name of names) counts.set(nameKey(name), (counts.get(nameKey(name)) ?? 0) + 1);
  const taken = new Set(names.map(nameKey));
  const next = new Map<string, number>();
  return names.map((name) => {
    const key = nameKey(name);
    if (counts.get(key)! < 2) return name;
    let n = next.get(key) ?? 0;
    let numbered: string;
    // Skip numbers another colour already uses as its name (a colour really called "Blue (1)").
    do numbered = `${name.trim()} (${++n})`;
    while (taken.has(nameKey(numbered)));
    next.set(key, n);
    return numbered;
  });
}
