// Built-in template format. Each template is ASCII art (one char per cell) plus a char → colour map;
// the first map entry is the background. Palette ids are fixed ("<slug>-<n>") so templates are stable.
import { BASIC_COLORS } from '../design';
import { DEFAULT_PRINT, DEFAULT_PUZZLE } from '../types';
import type { Design, Op, PrintSettings, PuzzleSettings } from '../types';

/** Colours templates may use: the default palette plus extra kid-friendly shades (English names). */
export const TEMPLATE_COLORS = {
  ...BASIC_COLORS,
  'Light yellow': '#fff59d',
  Gold: '#ffb300',
  Peach: '#ffcc80',
  'Dark red': '#b71c1c',
  'Light pink': '#f8bbd0',
  Magenta: '#d81b60',
  Lavender: '#ce93d8',
  Violet: '#7e57c2',
  'Light blue': '#bbdefb',
  Turquoise: '#26c6da',
  Teal: '#00897b',
  Navy: '#1a237e',
  Mint: '#a5d6a7',
  'Dark green': '#2e7d32',
  Olive: '#827717',
  Tan: '#d7a86e',
  'Dark brown': '#5d4037',
  'Dark gray': '#616161',
} as const;
export type TemplateColorName = keyof typeof TEMPLATE_COLORS;

export const TEMPLATE_CATEGORIES = ['animals', 'fantasy', 'food', 'nature', 'vehicles', 'things', 'holidays', 'shapes'] as const;
export type TemplateCategory = (typeof TEMPLATE_CATEGORIES)[number];

export interface TemplateSpec {
  /** Unique, kebab-case; the template id is "tpl-<slug>". */
  slug: string;
  name: string;
  category: TemplateCategory;
  /** char → colour name; insertion order = palette order, first entry = background. */
  colors: Record<string, TemplateColorName>;
  /** One string per row, all the same length; one char per cell. */
  art: string[];
  /** Missing fields fall back to DEFAULT_PUZZLE (legendMode 'range', blankBackground on). */
  puzzle: Pick<PuzzleSettings, 'ops' | 'addSubMax' | 'mulDivMax' | 'seed'> & Partial<PuzzleSettings>;
  print?: Partial<PrintSettings>;
}

export const ADD: Op[] = ['add'];
export const ADD_SUB: Op[] = ['add', 'sub'];
export const MUL: Op[] = ['mul'];
export const MUL_DIV: Op[] = ['mul', 'div'];
export const ALL4: Op[] = ['add', 'sub', 'mul', 'div'];

export function buildTemplate(spec: TemplateSpec): Design {
  const chars = Object.keys(spec.colors);
  const palette = chars.map((ch, i) => {
    const name = spec.colors[ch];
    return { id: `${spec.slug}-${i}`, name, hex: TEMPLATE_COLORS[name] };
  });
  const idOf = new Map(chars.map((ch, i) => [ch, palette[i].id]));
  return {
    id: `tpl-${spec.slug}`,
    name: spec.name,
    width: spec.art[0].length,
    height: spec.art.length,
    palette,
    backgroundId: palette[0].id,
    cells: spec.art.flatMap((row) => Array.from(row, (ch) => idOf.get(ch) ?? palette[0].id)),
    puzzle: { ...DEFAULT_PUZZLE, ...spec.puzzle },
    print: { ...DEFAULT_PRINT, ...spec.print },
    createdAt: 0,
    updatedAt: 0,
  };
}
