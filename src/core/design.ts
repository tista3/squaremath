// OWNER: core-data agent. Design construction, validation & editing helpers (all pure, return new objects).
import { nearestColorName, normalizeHex } from './colors';
import { randomSeed } from './puzzle';
import {
  ADD_SUB_LIMITS,
  ALL_OPS,
  DEFAULT_PRINT,
  DEFAULT_PUZZLE,
  GRID_MAX,
  GRID_MIN,
  MAX_PALETTE,
  MUL_DIV_LIMITS,
  NAME_MAX,
} from './types';
import type { Design, Op, PaletteColor, PrintSettings, PuzzleSettings } from './types';

export const DEFAULT_SIZE = 16;
export const UNTITLED = 'Untitled';
/** Hex used when an untrusted palette entry has an unusable colour. */
const FALLBACK_HEX = '#9e9e9e';
/** Ids are URL-path, DOM-attribute and storage-key safe (no '.', '/', '%', ...). */
const ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
/** Timestamps further in the future than this are treated as corrupt. */
const MAX_CLOCK_SKEW_MS = 86_400_000;

/** One character per palette index (share links and compact local storage). Never reorder. */
export const CELL_ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';

/** Basic kid-friendly colours (name → hex), also used by the built-in templates. */
export const BASIC_COLORS = {
  White: '#ffffff',
  Black: '#212121',
  Red: '#e53935',
  Orange: '#fb8c00',
  Yellow: '#fdd835',
  Green: '#43a047',
  'Light green': '#9ccc65',
  'Sky blue': '#81d4fa',
  Blue: '#1e88e5',
  Purple: '#8e24aa',
  Pink: '#f48fb1',
  Brown: '#8d6e63',
  Beige: '#f5deb3',
  'Light gray': '#cfd8dc',
  Gray: '#9e9e9e',
} as const;
export type BasicColorName = keyof typeof BASIC_COLORS;

const DEFAULT_PALETTE_NAMES: BasicColorName[] = [
  'White', 'Black', 'Red', 'Orange', 'Yellow', 'Green', 'Sky blue', 'Blue', 'Purple', 'Pink', 'Brown', 'Gray',
];

const ID_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';

/** Short random id (crypto.getRandomValues based), e.g. 10 chars [a-z0-9]. */
export function newId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(10));
  let id = '';
  for (const b of bytes) id += ID_ALPHABET[b % ID_ALPHABET.length];
  return id;
}

/** White (background, first), Black, Red, Orange, Yellow, Green, Sky blue, Blue, Purple, Pink, Brown, Gray.
 * Fresh ids each call. */
export function defaultPalette(): PaletteColor[] {
  return DEFAULT_PALETTE_NAMES.map((name) => ({ id: newId(), name, hex: BASIC_COLORS[name] }));
}

/** New design, default 16×16, default palette, backgroundId = White, all cells = background.
 * The puzzle gets a random seed, so different designs do not share legend layouts and expressions. */
export function createBlankDesign(opts?: { name?: string; width?: number; height?: number }): Design {
  const palette = defaultPalette();
  const width = clampInt(opts?.width, GRID_MIN, GRID_MAX, DEFAULT_SIZE);
  const height = clampInt(opts?.height, GRID_MIN, GRID_MAX, DEFAULT_SIZE);
  const now = Date.now();
  return {
    id: newId(),
    name: cleanName(opts?.name) || UNTITLED,
    width,
    height,
    palette,
    backgroundId: palette[0].id,
    cells: new Array<string>(width * height).fill(palette[0].id),
    puzzle: { ...DEFAULT_PUZZLE, ops: [...DEFAULT_PUZZLE.ops], seed: randomSeed() },
    print: { ...DEFAULT_PRINT },
    createdAt: now,
    updatedAt: now,
  };
}

// ---------------------------------------------------------------------------------------------
// Validation of untrusted data. Values are only ever read via own properties and copied into
// freshly built objects, so unknown keys (including "__proto__"/"constructor") never propagate.

type Rec = Record<string, unknown>;

function isRecord(v: unknown): v is Rec {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function field(obj: Rec, key: string): unknown {
  return Object.prototype.hasOwnProperty.call(obj, key) ? obj[key] : undefined;
}

function clampInt(v: unknown, min: number, max: number, fallback: number): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) return fallback;
  return Math.min(max, Math.max(min, Math.round(v)));
}

/** Lone (unpaired) UTF-16 surrogates and U+FFFE/U+FFFF: invalid in XML/SVG and in encodeURIComponent. */
const ILL_FORMED = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]|[￾￿]/g;

/** At most `max` UTF-16 units of `s`, never cutting a surrogate pair (emoji) in half. */
function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  const highSurrogateLast = /[\uD800-\uDBFF]/.test(s[max - 1]);
  return s.slice(0, highSurrogateLast ? max - 1 : max);
}

/** Trimmed single-line, well-formed name of at most NAME_MAX UTF-16 units ('' when unusable). */
export function cleanName(v: unknown): string {
  if (typeof v !== 'string') return '';
  const text = v.replace(ILL_FORMED, '').replace(/[\u0000-\u001f\u007f]+/g, ' ').trim();
  return truncate(text, NAME_MAX).trim();
}

/** The id when it is 1–64 chars of [A-Za-z0-9_-], otherwise null. */
export function cleanId(v: unknown): string | null {
  return typeof v === 'string' && ID_PATTERN.test(v) ? v : null;
}

/** Epoch ms in [0, now + 1 day]; anything else (negative, absurd future, non-number) gives `fallback`. */
function cleanTimestamp(v: unknown, fallback: number, now: number): number {
  const ok = typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= now + MAX_CLOCK_SKEW_MS;
  return ok ? Math.floor(v) : fallback;
}

function pick<T extends string>(v: unknown, allowed: readonly T[], fallback: T): T {
  return allowed.includes(v as T) ? (v as T) : fallback;
}

function normalizeColor(raw: unknown, taken: Set<string>): PaletteColor | null {
  if (!isRecord(raw)) return null;
  const hexIn = field(raw, 'hex');
  const hex = (typeof hexIn === 'string' && normalizeHex(hexIn)) || FALLBACK_HEX;
  let id = cleanId(field(raw, 'id'));
  if (id === null || taken.has(id)) id = uniqueId(taken);
  taken.add(id);
  return { id, name: cleanName(field(raw, 'name')) || nearestColorName(hex), hex };
}

function uniqueId(taken: Set<string>): string {
  let id = newId();
  while (taken.has(id)) id = newId();
  return id;
}

/** Normalised palette plus a map from every original (valid string) id to the id it now has. */
function normalizePalette(raw: unknown): { palette: PaletteColor[]; idMap: Map<string, string> } {
  const palette: PaletteColor[] = [];
  const idMap = new Map<string, string>();
  if (!Array.isArray(raw)) return { palette, idMap };
  const taken = new Set<string>();
  // Bounded scan so a huge hostile array cannot stall the app.
  for (const entry of raw.slice(0, MAX_PALETTE * 4)) {
    if (palette.length >= MAX_PALETTE) break;
    const color = normalizeColor(entry, taken);
    if (!color) continue;
    palette.push(color);
    const origId = isRecord(entry) ? cleanId(field(entry, 'id')) : null;
    if (origId !== null && !idMap.has(origId)) idMap.set(origId, color.id);
  }
  return { palette, idMap };
}

function normalizeOps(raw: unknown): Op[] {
  const given = Array.isArray(raw) ? raw.slice(0, 16) : [];
  const ops = ALL_OPS.filter((op) => given.includes(op));
  return ops.length > 0 ? ops : [...DEFAULT_PUZZLE.ops];
}

function normalizePuzzle(raw: unknown): PuzzleSettings {
  const p = isRecord(raw) ? raw : {};
  const seed = field(p, 'seed');
  return {
    ops: normalizeOps(field(p, 'ops')),
    addSubMax: clampInt(field(p, 'addSubMax'), ADD_SUB_LIMITS.min, ADD_SUB_LIMITS.max, DEFAULT_PUZZLE.addSubMax),
    mulDivMax: clampInt(field(p, 'mulDivMax'), MUL_DIV_LIMITS.min, MUL_DIV_LIMITS.max, DEFAULT_PUZZLE.mulDivMax),
    legendMode: pick(field(p, 'legendMode'), ['range', 'value'], DEFAULT_PUZZLE.legendMode),
    seed: typeof seed === 'number' && Number.isFinite(seed) ? Math.trunc(seed) >>> 0 : DEFAULT_PUZZLE.seed,
  };
}

function bool(v: unknown, fallback: boolean): boolean {
  return typeof v === 'boolean' ? v : fallback;
}

function normalizePrint(raw: unknown): PrintSettings {
  const p = isRecord(raw) ? raw : {};
  const d = DEFAULT_PRINT;
  return {
    paper: pick(field(p, 'paper'), ['A4', 'Letter'], d.paper),
    orientation: pick(field(p, 'orientation'), ['auto', 'portrait', 'landscape'], d.orientation),
    divSymbol: pick(field(p, 'divSymbol'), ['÷', ':'], d.divSymbol),
    mulSymbol: pick(field(p, 'mulSymbol'), ['×', '·'], d.mulSymbol),
    showTitle: bool(field(p, 'showTitle'), d.showTitle),
    includeSolution: bool(field(p, 'includeSolution'), d.includeSolution),
    legendSwatches: bool(field(p, 'legendSwatches'), d.legendSwatches),
  };
}

function normalizeCells(raw: unknown, count: number, idMap: Map<string, string>, backgroundId: string): string[] {
  const given = Array.isArray(raw) ? raw.slice(0, count) : [];
  const cells = given.map((c) => (typeof c === 'string' && idMap.get(c)) || backgroundId);
  while (cells.length < count) cells.push(backgroundId);
  return cells;
}

/** Validate & repair UNTRUSTED data (localStorage, imported file, share link). Clamps sizes, fixes cells
 * length / unknown ids (→ background), dedupes palette ids, fixes hex, fills missing settings with
 * defaults, clamps numeric settings, truncates names to NAME_MAX. Returns null if hopeless
 * (not an object, no usable dimensions, or no usable palette colour). */
export function normalizeDesign(raw: unknown): Design | null {
  if (!isRecord(raw)) return null;
  const rawW = field(raw, 'width');
  const rawH = field(raw, 'height');
  if (typeof rawW !== 'number' || typeof rawH !== 'number' || !Number.isFinite(rawW) || !Number.isFinite(rawH)) {
    return null;
  }
  const { palette, idMap } = normalizePalette(field(raw, 'palette'));
  if (palette.length === 0) return null;

  const width = clampInt(rawW, GRID_MIN, GRID_MAX, DEFAULT_SIZE);
  const height = clampInt(rawH, GRID_MIN, GRID_MAX, DEFAULT_SIZE);
  const bgRaw = field(raw, 'backgroundId');
  const backgroundId = (typeof bgRaw === 'string' && idMap.get(bgRaw)) || palette[0].id;
  const now = Date.now();
  const createdAt = cleanTimestamp(field(raw, 'createdAt'), now, now);
  return {
    id: cleanId(field(raw, 'id')) ?? newId(),
    name: cleanName(field(raw, 'name')) || UNTITLED,
    width,
    height,
    palette,
    backgroundId,
    cells: normalizeCells(field(raw, 'cells'), width * height, idMap, backgroundId),
    puzzle: normalizePuzzle(field(raw, 'puzzle')),
    print: normalizePrint(field(raw, 'print')),
    createdAt,
    updatedAt: cleanTimestamp(field(raw, 'updatedAt'), createdAt, now),
  };
}

// ---------------------------------------------------------------------------------------------
// Editing helpers

/** Resize keeping the picture anchored (default 'center'); new cells = background. Clamped to GRID_MIN..GRID_MAX. */
export function resizeDesign(d: Design, width: number, height: number, anchor: 'top-left' | 'center' = 'center'): Design {
  const w = clampInt(width, GRID_MIN, GRID_MAX, d.width);
  const h = clampInt(height, GRID_MIN, GRID_MAX, d.height);
  if (w === d.width && h === d.height) return d;
  // Offset of the old picture inside the new grid (negative = cropped on that side).
  const dx = anchor === 'center' ? Math.floor((w - d.width) / 2) : 0;
  const dy = anchor === 'center' ? Math.floor((h - d.height) / 2) : 0;
  const cells = new Array<string>(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const ox = x - dx;
      const oy = y - dy;
      const inside = ox >= 0 && ox < d.width && oy >= 0 && oy < d.height;
      cells[y * w + x] = inside ? d.cells[oy * d.width + ox] : d.backgroundId;
    }
  }
  return { ...d, width: w, height: h, cells };
}

/** Cells as one CELL_ALPHABET character per palette index, row-major (unknown ids → background). */
export function cellsToString(d: Design): string {
  const index = new Map(d.palette.map((c, i) => [c.id, CELL_ALPHABET[i]]));
  const bg = index.get(d.backgroundId) ?? CELL_ALPHABET[0];
  let out = '';
  for (const id of d.cells) out += index.get(id) ?? bg;
  return out;
}

/** Palette ids actually used in cells, in palette order. */
export function usedColorIds(d: Design): string[] {
  const used = new Set(d.cells);
  return d.palette.filter((c) => used.has(c.id)).map((c) => c.id);
}

/** Add a colour (name defaults to nearestColorName(hex)); no-op if palette is full (MAX_PALETTE)
 * or the hex is invalid. */
export function addPaletteColor(d: Design, hex: string, name?: string): Design {
  const norm = normalizeHex(hex);
  if (!norm || d.palette.length >= MAX_PALETTE) return d;
  const id = uniqueId(new Set(d.palette.map((c) => c.id)));
  const color: PaletteColor = { id, name: cleanName(name) || nearestColorName(norm), hex: norm };
  return { ...d, palette: [...d.palette, color] };
}

/** Remove a colour; its cells become background. Removing the background colour is a no-op. */
export function removePaletteColor(d: Design, colorId: string): Design {
  if (colorId === d.backgroundId || !d.palette.some((c) => c.id === colorId)) return d;
  return {
    ...d,
    palette: d.palette.filter((c) => c.id !== colorId),
    cells: d.cells.map((c) => (c === colorId ? d.backgroundId : c)),
  };
}

/** Deep copy with a new id and fresh createdAt/updatedAt; optional overrides (e.g. name). */
export function cloneDesign(d: Design, overrides?: Partial<Pick<Design, 'name'>>): Design {
  const now = Date.now();
  return {
    ...d,
    id: newId(),
    name: cleanName(overrides?.name) || d.name,
    palette: d.palette.map((c) => ({ ...c })),
    cells: [...d.cells],
    puzzle: { ...d.puzzle, ops: [...d.puzzle.ops] },
    print: { ...d.print },
    createdAt: now,
    updatedAt: now,
  };
}

const COPY_SUFFIX = /^(.*?)\s*\(copy(?:\s+(\d+))?\)$/;

/** "Heart" -> "Heart (copy)", "Heart (copy)" -> "Heart (copy 2)", ... avoiding names in `existing`. */
export function copyName(name: string, existing: string[]): string {
  const clean = cleanName(name);
  const m = COPY_SUFFIX.exec(clean);
  const base = (m ? m[1] : clean) || UNTITLED;
  let n = m ? (m[2] ? Number(m[2]) + 1 : 2) : 1;
  const taken = new Set(existing);
  for (;;) {
    const suffix = n === 1 ? ' (copy)' : ` (copy ${n})`;
    const candidate = truncate(base, NAME_MAX - suffix.length).trimEnd() + suffix;
    if (!taken.has(candidate)) return candidate;
    n++;
  }
}
