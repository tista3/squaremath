import { formatLegendValues } from '../../core/puzzle';
import type { Design, LegendEntry } from '../../core/types';
import { distinctNames, sortLegendForDisplay } from '../../render/legendOrder';

/** Legend entry joined with its palette colour, ready for display. */
export interface LegendItem {
  colorId: string;
  /** Colour name, numbered ("Blue (1)", "Blue (2)") when several legend colours share it. */
  name: string;
  hex: string;
  /** "1–10" or "3, 7, 12" depending on the design's legend mode. */
  values: string;
}

const nameKey = (name: string) => name.trim().toLocaleLowerCase();

export { distinctNames };

/** Names shared by several colours that appear in the picture (each listed once, first spelling). */
export function duplicateColorNames(design: Pick<Design, 'palette' | 'cells'>): string[] {
  const used = new Set(design.cells);
  const firstSpelling = new Map<string, string>();
  const dupes = new Set<string>();
  for (const color of design.palette) {
    if (!used.has(color.id)) continue;
    const key = nameKey(color.name);
    if (firstSpelling.has(key)) dupes.add(key);
    else firstSpelling.set(key, color.name.trim());
  }
  return [...dupes].map((key) => firstSpelling.get(key)!);
}

/**
 * Legend items in number order (the same order as the printed key). Duplicate names are numbered in
 * palette order first, so "Blue (1)" names the same colour on screen and on paper.
 */
export function legendItems(design: Design, legend: LegendEntry[]): LegendItem[] {
  const byId = new Map(design.palette.map((c) => [c.id, c]));
  const items = legend.flatMap((entry) => {
    const color = byId.get(entry.colorId);
    if (!color) return [];
    const values = formatLegendValues(entry, design.puzzle.legendMode);
    return [{ colorId: entry.colorId, name: color.name, hex: color.hex, values }];
  });
  const names = distinctNames(items.map((item) => item.name));
  const numbered = new Map(items.map((item, i) => [item.colorId, { ...item, name: names[i] }]));
  return sortLegendForDisplay(legend, design.puzzle.legendMode).flatMap((entry) => {
    const item = numbered.get(entry.colorId);
    return item ? [item] : [];
  });
}
