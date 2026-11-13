// OWNER: core-data agent. Share-link encoding (URL-safe, compact; lz-string compressToEncodedURIComponent).
//
// Payload = "1~" + lz(JSON of a positional array):
//   [name, width, height, [[colourName, "rrggbb"], ...], backgroundIndex, cells, puzzle, print]
//   cells  = one char per cell, CELL_ALPHABET[paletteIndex], row-major
//   puzzle = [opsBitmask (ALL_OPS order), addSubMax, mulDivMax, legendModeIndex, seed]
//   print  = [paperIndex, orientationIndex, divSymbolIndex, mulSymbolIndex, flags (1 title, 2 solution, 4 swatches)]
// lz-string's URI alphabet is [A-Za-z0-9+$-], so with "~" the payload never contains '/', '?' or '#'.
import { compressToEncodedURIComponent } from 'lz-string';
import { routes } from '../routes';
import { CELL_ALPHABET, cellsToString, normalizeDesign } from './design';
import { decompressFromUriBounded } from './lz';
import { ALL_OPS, GRID_MAX, MAX_PALETTE } from './types';
import type { Design, PrintSettings, PuzzleSettings } from './types';

const PREFIX = '1~';
/** Generous upper bound on the link payload (a worst-case 40×40, 24-colour design with long non-Latin
 * names encodes to about 9,000 chars). */
const MAX_PAYLOAD_LENGTH = 40_000;
/** Upper bound on the decompressed JSON (the worst case above is about 5,000 chars). lz output can grow
 * quadratically with the input, so decompression stops here instead of building a huge string. */
const MAX_JSON_LENGTH = 100_000;

const PAPERS: readonly PrintSettings['paper'][] = ['A4', 'Letter'];
const ORIENTATIONS: readonly PrintSettings['orientation'][] = ['auto', 'portrait', 'landscape'];
const DIV_SYMBOLS: readonly PrintSettings['divSymbol'][] = ['÷', ':'];
const MUL_SYMBOLS: readonly PrintSettings['mulSymbol'][] = ['×', '·'];
const LEGEND_MODES: readonly PuzzleSettings['legendMode'][] = ['range', 'value'];
const FLAG_TITLE = 1;
const FLAG_SOLUTION = 2;
const FLAG_SWATCHES = 4;

type CompactPuzzle = [number, number, number, number, number];
type CompactPrint = [number, number, number, number, number];
type Compact = [string, number, number, [string, string][], number, string, CompactPuzzle, CompactPrint];

function toCompact(d: Design): Compact {
  const bg = Math.max(0, d.palette.findIndex((c) => c.id === d.backgroundId));
  const p = d.puzzle;
  const opsMask = ALL_OPS.reduce((mask, op, i) => (p.ops.includes(op) ? mask | (1 << i) : mask), 0);
  const pr = d.print;
  const flags =
    (pr.showTitle ? FLAG_TITLE : 0) | (pr.includeSolution ? FLAG_SOLUTION : 0) | (pr.legendSwatches ? FLAG_SWATCHES : 0);
  return [
    d.name,
    d.width,
    d.height,
    d.palette.map((c) => [c.name, c.hex.slice(1)]),
    bg,
    cellsToString(d),
    [opsMask, p.addSubMax, p.mulDivMax, LEGEND_MODES.indexOf(p.legendMode), p.seed],
    [
      PAPERS.indexOf(pr.paper),
      ORIENTATIONS.indexOf(pr.orientation),
      DIV_SYMBOLS.indexOf(pr.divSymbol),
      MUL_SYMBOLS.indexOf(pr.mulSymbol),
      flags,
    ],
  ];
}

/** Element `i` of `list` when `i` is a valid index; undefined otherwise (normalizeDesign then uses defaults). */
function at<T>(list: readonly T[], i: unknown): T | undefined {
  return typeof i === 'number' && Number.isInteger(i) && i >= 0 && i < list.length ? list[i] : undefined;
}

const paletteId = (i: number) => `c${i}`;

function expandPuzzle(raw: unknown): Partial<Record<keyof PuzzleSettings, unknown>> | undefined {
  if (!Array.isArray(raw)) return undefined;
  const [mask, addSubMax, mulDivMax, legend, seed] = raw;
  return {
    ops: typeof mask === 'number' ? ALL_OPS.filter((_, i) => mask & (1 << i)) : undefined,
    addSubMax,
    mulDivMax,
    legendMode: at(LEGEND_MODES, legend),
    seed,
  };
}

function expandPrint(raw: unknown): Partial<Record<keyof PrintSettings, unknown>> | undefined {
  if (!Array.isArray(raw)) return undefined;
  const [paper, orientation, div, mul, flags] = raw;
  const hasFlags = typeof flags === 'number';
  return {
    paper: at(PAPERS, paper),
    orientation: at(ORIENTATIONS, orientation),
    divSymbol: at(DIV_SYMBOLS, div),
    mulSymbol: at(MUL_SYMBOLS, mul),
    showTitle: hasFlags ? (flags & FLAG_TITLE) !== 0 : undefined,
    includeSolution: hasFlags ? (flags & FLAG_SOLUTION) !== 0 : undefined,
    legendSwatches: hasFlags ? (flags & FLAG_SWATCHES) !== 0 : undefined,
  };
}

/** Compact array → raw design-shaped object (still untrusted; normalizeDesign does the validation). */
function fromCompact(c: unknown): Record<string, unknown> | null {
  if (!Array.isArray(c) || c.length < 6) return null;
  const [name, width, height, palette, bg, cells, puzzle, print] = c;
  if (!Array.isArray(palette) || typeof cells !== 'string') return null;
  return {
    name,
    width,
    height,
    palette: palette.slice(0, MAX_PALETTE).map((entry: unknown, i) =>
      Array.isArray(entry) ? { id: paletteId(i), name: entry[0], hex: typeof entry[1] === 'string' ? `#${entry[1]}` : null } : null,
    ),
    backgroundId: typeof bg === 'number' ? paletteId(bg) : undefined,
    cells: Array.from(cells.slice(0, GRID_MAX * GRID_MAX), (ch) => paletteId(CELL_ALPHABET.indexOf(ch))),
    puzzle: expandPuzzle(puzzle),
    print: expandPrint(print),
  };
}

/** 64-bit string hash (two independent 32-bit FNV-1a style lanes) as base36. */
function hashString(s: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193 ^ s.length;
  for (let i = 0; i < s.length; i++) {
    const ch = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 0x01000193);
    h2 = Math.imul(h2 ^ ch, 0x5bd1e995);
    h2 ^= h2 >>> 15;
  }
  return (h1 >>> 0).toString(36) + (h2 >>> 0).toString(36);
}

/** Compact URL-safe payload with a version prefix. Excludes id/timestamps. Includes name, size,
 * palette (names+hex), background, cells, puzzle & print settings (so recipients get the identical sheet). */
export function encodeDesign(d: Design): string {
  return PREFIX + compressToEncodedURIComponent(JSON.stringify(toCompact(d)));
}

/** Inverse of encodeDesign; result passes normalizeDesign. id is deterministic from the payload
 * ("shared-" + hash of the decompressed content) so the same link yields the same id; palette ids are
 * "c0", "c1", ... and timestamps 0. null on any failure. */
export function decodeDesign(payload: string): Design | null {
  try {
    if (typeof payload !== 'string') return null;
    // Links pasted through some apps arrive percent-encoded.
    const text = payload.includes('%') ? decodeURIComponent(payload) : payload;
    if (!text.startsWith(PREFIX) || text.length > MAX_PAYLOAD_LENGTH) return null;
    const json = decompressFromUriBounded(text.slice(PREFIX.length), MAX_JSON_LENGTH);
    if (!json) return null;
    const raw = fromCompact(JSON.parse(json));
    if (!raw) return null;
    return normalizeDesign({ ...raw, id: `shared-${hashString(json)}`, createdAt: 0, updatedAt: 0 });
  } catch {
    return null;
  }
}

/** Absolute link that opens the shared design: `${origin}${pathname}#/s/${payload}`. */
export function buildShareUrl(d: Design): string {
  const { origin, pathname } = window.location;
  return `${origin}${pathname}#${routes.shared(encodeDesign(d))}`;
}
