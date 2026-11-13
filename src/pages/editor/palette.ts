// Pure palette helpers for the editor.
import { CRAYONS } from '../../core/colors';
import type { Design, PaletteColor } from '../../core/types';

/** Number of cells per palette id. */
export function countCells(cells: string[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const id of cells) counts.set(id, (counts.get(id) ?? 0) + 1);
  return counts;
}

/** Colour names used by more than one palette entry (case/whitespace-insensitive), as first spelled. */
export function duplicateNames(palette: PaletteColor[]): string[] {
  const seen = new Map<string, { name: string; count: number }>();
  for (const c of palette) {
    const key = c.name.trim().toLowerCase();
    const entry = seen.get(key);
    if (entry) entry.count++;
    else seen.set(key, { name: c.name.trim(), count: 1 });
  }
  return [...seen.values()].filter((e) => e.count > 1).map((e) => e.name);
}

/** Cells that are not background. */
export function paintedCount(d: Pick<Design, 'cells' | 'backgroundId'>): number {
  return d.cells.reduce((n, id) => (id === d.backgroundId ? n : n + 1), 0);
}

/** Change a colour's hex; an auto-suggested name follows the new colour, a custom name is kept. */
export function recolor(color: PaletteColor, newHex: string, suggestName: (hex: string) => string): PaletteColor {
  const autoNamed = color.name === suggestName(color.hex);
  return { ...color, hex: newHex, name: autoNamed ? suggestName(newHex) : color.name };
}

/** The selected id if it still exists, else the first non-background colour (or the background). */
export function resolveSelected(palette: PaletteColor[], backgroundId: string, selectedId: string | null): string {
  if (selectedId && palette.some((c) => c.id === selectedId)) return selectedId;
  return (palette.find((c) => c.id !== backgroundId) ?? palette[0]).id;
}

/** Palette id `step` positions away from `currentId`, wrapping around. */
export function cycleColorId(palette: PaletteColor[], currentId: string, step: number): string {
  const n = palette.length;
  const i = Math.max(0, palette.findIndex((c) => c.id === currentId));
  return palette[(((i + step) % n) + n) % n].id;
}

const nameKey = (name: string) => name.trim().toLowerCase();

/** `name`, or "name 2", "name 3", … when the palette already has a colour called that (case-insensitive). */
export function uniqueName(name: string, palette: PaletteColor[]): string {
  const taken = new Set(palette.map((c) => nameKey(c.name)));
  const base = name.trim();
  if (!taken.has(nameKey(base))) return base;
  let n = 2;
  while (taken.has(nameKey(`${base} ${n}`))) n++;
  return `${base} ${n}`;
}

/** Whether a colour with exactly this hex is already in the palette. */
export function hasHex(palette: PaletteColor[], hex: string): boolean {
  const h = hex.toLowerCase();
  return palette.some((c) => c.hex.toLowerCase() === h);
}

/** Bright, easy-to-tell-apart colours offered first by "Add colour" (names from the crayon list). */
const ADD_PRESETS = [
  'Orange', 'Yellow', 'Green', 'Sky blue', 'Blue', 'Purple', 'Pink', 'Red', 'Brown', 'Lime', 'Teal',
  'Magenta', 'Black', 'Gray', 'Navy', 'Coral', 'Turquoise', 'Gold', 'Dark green', 'Violet', 'Peach', 'Beige',
];
const PRESET_COLORS = [
  ...ADD_PRESETS.map((name) => CRAYONS.find((c) => c.name === name)!),
  ...CRAYONS.filter((c) => !ADD_PRESETS.includes(c.name)),
];

/**
 * Colour to offer next in "Add colour": the first preset after `afterHex` (wrapping around) whose hex and
 * name are both unused in the palette, so repeated taps never add the same colour twice. Falls back to
 * `afterHex` when every preset is taken.
 */
export function nextFreshColor(palette: PaletteColor[], afterHex?: string): string {
  const names = new Set(palette.map((c) => nameKey(c.name)));
  const start = PRESET_COLORS.findIndex((c) => c.hex === afterHex?.toLowerCase()) + 1;
  for (let i = 0; i < PRESET_COLORS.length; i++) {
    const c = PRESET_COLORS[(start + i) % PRESET_COLORS.length];
    if (!hasHex(palette, c.hex) && !names.has(nameKey(c.name))) return c.hex;
  }
  return afterHex ?? PRESET_COLORS[0].hex;
}
