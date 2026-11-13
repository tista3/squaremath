import { describe, expect, it } from 'vitest';
import { nearestColorName } from './colors';
import {
  CELL_ALPHABET,
  addPaletteColor,
  cellsToString,
  cleanId,
  cleanName,
  cloneDesign,
  copyName,
  createBlankDesign,
  defaultPalette,
  newId,
  normalizeDesign,
  removePaletteColor,
  resizeDesign,
  usedColorIds,
} from './design';
import { DEFAULT_PRINT, DEFAULT_PUZZLE, GRID_MAX, GRID_MIN, MAX_PALETTE, NAME_MAX } from './types';
import type { Design } from './types';

/** Design whose cells spell out `rows` (chars are palette ids "a","b","c"...). May be below GRID_MIN. */
function fromRows(rows: string[], colors = 3): Design {
  const base = createBlankDesign({ width: rows[0].length, height: rows.length });
  const palette = base.palette.slice(0, colors).map((c, i) => ({ ...c, id: String.fromCharCode(97 + i) }));
  return { ...base, width: rows[0].length, height: rows.length, palette, backgroundId: 'a', cells: rows.join('').split('') };
}

function rowsOf(d: Design): string[] {
  const out: string[] = [];
  for (let y = 0; y < d.height; y++) out.push(d.cells.slice(y * d.width, (y + 1) * d.width).join(''));
  return out;
}

const SMILE = '\u{1F600}'; // one emoji, two UTF-16 units

describe('newId / defaultPalette / createBlankDesign', () => {
  it('creates short unique ids', () => {
    const ids = new Set(Array.from({ length: 200 }, newId));
    expect(ids.size).toBe(200);
    for (const id of ids) expect(id).toMatch(/^[a-z0-9]{10}$/);
  });

  it('default palette starts with White and has fresh ids', () => {
    const a = defaultPalette();
    const b = defaultPalette();
    expect(a[0].name).toBe('White');
    expect(a.map((c) => c.name)).toContain('Sky blue');
    expect(a[0].id).not.toBe(b[0].id);
  });

  it('blank design is valid and all background', () => {
    const d = createBlankDesign({ name: '  My pic ', width: 1000, height: 2 });
    expect(d.name).toBe('My pic');
    expect([d.width, d.height]).toEqual([GRID_MAX, GRID_MIN]);
    expect(d.cells).toHaveLength(GRID_MAX * GRID_MIN);
    expect(new Set(d.cells)).toEqual(new Set([d.backgroundId]));
    expect(normalizeDesign(d)).toEqual(d);
    expect(createBlankDesign().width).toBe(16);
  });

  it('gives every new design its own random puzzle seed', () => {
    const designs = Array.from({ length: 10 }, () => createBlankDesign());
    expect(new Set(designs.map((d) => d.puzzle.seed)).size).toBeGreaterThan(1);
    for (const d of designs) {
      expect(Number.isInteger(d.puzzle.seed) && d.puzzle.seed >= 0 && d.puzzle.seed <= 0xffffffff).toBe(true);
      expect({ ...d.puzzle, seed: DEFAULT_PUZZLE.seed }).toEqual(DEFAULT_PUZZLE);
      expect(d.puzzle.ops).not.toBe(DEFAULT_PUZZLE.ops);
    }
  });
});

describe('cleanName / cleanId', () => {
  const expectWellFormed = (s: string) => {
    expect(() => encodeURIComponent(s)).not.toThrow();
    expect(s).not.toMatch(/[￾￿]/);
  };

  it('never cuts an emoji in half when truncating', () => {
    const clean = cleanName('a' + SMILE.repeat(40)); // 81 units
    expect(clean).toBe('a' + SMILE.repeat(29));
    expect(clean.length).toBeLessThanOrEqual(NAME_MAX);
    expectWellFormed(clean);
  });

  it('strips lone surrogates and non-characters', () => {
    expect(cleanName('a\uD83Db\uDE00c￾d￿')).toBe('abcd');
    expect(cleanName(`ok ${SMILE}`)).toBe(`ok ${SMILE}`);
    const d = normalizeDesign({ width: 4, height: 4, name: 'x\uD800', palette: [{ hex: '#fff', name: '￾Blue' }] })!;
    expect(d.name).toBe('x');
    expect(d.palette[0].name).toBe('Blue');
    expectWellFormed(d.name);
  });

  it('accepts only URL-safe ids', () => {
    for (const id of ['abc123', 'tpl-star', 'shared-1x2y', 'c0', 'A_b-9', 'x'.repeat(64)]) expect(cleanId(id)).toBe(id);
    for (const id of ['', '.', '..', 'a/b', 'a.b', 'a%2F', 'a b', 'é', 'x'.repeat(65), 5, null]) expect(cleanId(id)).toBeNull();
    const d = normalizeDesign({ id: '..', width: 4, height: 4, palette: [{ id: '.', hex: '#fff' }], cells: ['.'] })!;
    expect(d.id).toMatch(/^[a-z0-9]{10}$/);
    expect(d.palette[0].id).toMatch(/^[a-z0-9]{10}$/);
    expect(new Set(d.cells)).toEqual(new Set([d.palette[0].id]));
  });
});

describe('normalizeDesign', () => {
  it('rejects hopeless input', () => {
    for (const raw of [null, undefined, 42, 'x', [], {}, { width: 5, height: 5 }, { width: 'a', height: 5, palette: [{ hex: '#fff' }] }]) {
      expect(normalizeDesign(raw)).toBeNull();
    }
    expect(normalizeDesign({ width: NaN, height: 4, palette: [{ hex: '#fff' }] })).toBeNull();
    expect(normalizeDesign({ width: 4, height: 4, palette: [1, 'x', null] })).toBeNull();
  });

  it('fills every missing field with defaults', () => {
    const d = normalizeDesign({ width: 4, height: 4, palette: [{ hex: 'F00' }] })!;
    expect(d).not.toBeNull();
    expect(d.name).toBe('Untitled');
    expect(d.id).toMatch(/^[a-z0-9]{10}$/);
    expect(d.palette).toHaveLength(1);
    expect(d.palette[0].hex).toBe('#ff0000');
    expect(d.palette[0].name).toBe(nearestColorName('#ff0000'));
    expect(d.backgroundId).toBe(d.palette[0].id);
    expect(d.cells).toEqual(new Array(16).fill(d.palette[0].id));
    expect(d.puzzle).toEqual(DEFAULT_PUZZLE);
    expect(d.print).toEqual(DEFAULT_PRINT);
    expect(d.updatedAt).toBe(d.createdAt);
  });

  it('repairs wrong types, bad hex, duplicate ids and unknown cell ids', () => {
    const d = normalizeDesign({
      id: 123,
      name: `  ${'x'.repeat(200)}\n `,
      width: 4.4,
      height: 999,
      palette: [{ id: 'a', name: 'Bg', hex: '#ffffff' }, { id: 'a', name: 7, hex: 'nope' }, 'junk', { id: 'b', hex: '#000' }],
      backgroundId: 'zzz',
      cells: ['b', 'a', 'q', 5, null],
      puzzle: { ops: ['mul', 'pow', 'mul', 'add'], addSubMax: 1e9, mulDivMax: -3, legendMode: 'x', seed: -1 },
      print: { paper: 'A3', orientation: 'landscape', divSymbol: ':', mulSymbol: 'x', showTitle: 'yes', includeSolution: true },
      createdAt: -5,
      updatedAt: Infinity,
    })!;
    expect(d.id).not.toBe(123);
    expect(d.name).toHaveLength(NAME_MAX);
    expect([d.width, d.height]).toEqual([4, GRID_MAX]);
    expect(d.palette).toHaveLength(3);
    const ids = d.palette.map((c) => c.id);
    expect(new Set(ids).size).toBe(3);
    expect(ids[0]).toBe('a');
    expect(ids[2]).toBe('b');
    expect(d.palette[1].hex).toMatch(/^#[0-9a-f]{6}$/);
    expect(d.palette[1].name.length).toBeGreaterThan(0);
    expect(d.palette[2].name).toBe(nearestColorName('#000000'));
    expect(d.backgroundId).toBe('a');
    expect(d.cells).toHaveLength(4 * GRID_MAX);
    expect(d.cells.slice(0, 5)).toEqual(['b', 'a', 'a', 'a', 'a']);
    expect(d.puzzle).toEqual({ ops: ['add', 'mul'], addSubMax: 1000, mulDivMax: 2, legendMode: 'range', seed: 0xffffffff, blankBackground: true });
    expect(d.print).toEqual({ ...DEFAULT_PRINT, orientation: 'landscape', divSymbol: ':', includeSolution: true });
    expect(d.createdAt).toBeGreaterThan(0);
    expect(d.updatedAt).toBe(d.createdAt);
  });

  it('caps palette size and truncates oversized cell arrays', () => {
    const palette = Array.from({ length: 100 }, (_, i) => ({ id: `p${i}`, name: `C${i}`, hex: '#123456' }));
    const d = normalizeDesign({ width: 4, height: 4, palette, cells: new Array(1_000_000).fill('p30') })!;
    expect(d.palette).toHaveLength(MAX_PALETTE);
    expect(d.cells).toHaveLength(16);
    expect(new Set(d.cells)).toEqual(new Set(['p0']));
  });

  it('ignores prototype-pollution keys', () => {
    const raw = JSON.parse(
      '{"width":4,"height":4,"palette":[{"hex":"#fff","__proto__":{"evil":1}}],"__proto__":{"polluted":true},"constructor":{"prototype":{"bad":1}},"puzzle":{"__proto__":{"ops":["div"]}}}',
    );
    const d = normalizeDesign(raw)!;
    expect(d).not.toBeNull();
    expect(Object.keys(d)).not.toContain('__proto__');
    expect(Object.keys(d)).not.toContain('constructor');
    expect(d.puzzle.ops).toEqual(DEFAULT_PUZZLE.ops);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(({} as Record<string, unknown>).bad).toBeUndefined();
  });

  it('empty or invalid ops fall back to defaults; seed becomes uint32', () => {
    const base = { width: 4, height: 4, palette: [{ hex: '#fff' }] };
    expect(normalizeDesign({ ...base, puzzle: { ops: [] } })!.puzzle.ops).toEqual(DEFAULT_PUZZLE.ops);
    expect(normalizeDesign({ ...base, puzzle: { ops: 'add' } })!.puzzle.ops).toEqual(DEFAULT_PUZZLE.ops);
    expect(normalizeDesign({ ...base, puzzle: { seed: 2 ** 32 + 5.7 } })!.puzzle.seed).toBe(5);
    expect(normalizeDesign({ ...base, puzzle: { seed: 'x' } })!.puzzle.seed).toBe(DEFAULT_PUZZLE.seed);
  });

  it('treats absurd future timestamps as corrupt', () => {
    const base = { width: 4, height: 4, palette: [{ hex: '#fff' }] };
    const before = Date.now();
    const d = normalizeDesign({ ...base, createdAt: 9e15, updatedAt: 1e300 })!;
    expect(d.createdAt).toBeGreaterThanOrEqual(before);
    expect(d.createdAt).toBeLessThanOrEqual(Date.now());
    expect(d.updatedAt).toBe(d.createdAt);
    expect(normalizeDesign({ ...base, createdAt: 5, updatedAt: before + 3_600_000 })!.updatedAt).toBe(before + 3_600_000);
    expect(normalizeDesign({ ...base, createdAt: 0, updatedAt: 0 })!.updatedAt).toBe(0);
  });

  it('is idempotent on valid designs', () => {
    const d = createBlankDesign();
    const n = normalizeDesign(JSON.parse(JSON.stringify(d)));
    expect(n).toEqual(d);
  });
});

describe('resizeDesign', () => {
  const d = fromRows(['ab', 'ca']);

  it('grows around the centre', () => {
    const r = resizeDesign(d, 5, 4);
    expect(rowsOf(r)).toEqual(['aaaaa', 'aabaa', 'acaaa', 'aaaaa']);
  });

  it('grows from the top-left', () => {
    const r = resizeDesign(fromRows(['bbbb', 'bbbb', 'bbbb', 'bbbb']), 6, 5, 'top-left');
    expect(rowsOf(r)).toEqual(['bbbbaa', 'bbbbaa', 'bbbbaa', 'bbbbaa', 'aaaaaa']);
  });

  it('shrinks around the centre and clamps', () => {
    const big = fromRows(['aaaaaa', 'abbbba', 'abccba', 'abccba', 'abbbba', 'aaaaaa']);
    expect(rowsOf(resizeDesign(big, 4, 4))).toEqual(['bbbb', 'bccb', 'bccb', 'bbbb']);
    const clamped = resizeDesign(big, 1, 100);
    expect([clamped.width, clamped.height]).toEqual([GRID_MIN, GRID_MAX]);
    expect(clamped.cells).toHaveLength(GRID_MIN * GRID_MAX);
  });

  it('returns the same design when size is unchanged', () => {
    const big = fromRows(['abca', 'abca', 'abca', 'abca']);
    expect(resizeDesign(big, 4, 4)).toBe(big);
  });
});

describe('palette helpers', () => {
  const d = fromRows(['abca', 'aaaa', 'aaaa', 'aaab']);

  it('encodes cells as palette indexes', () => {
    expect(cellsToString(d)).toBe('0120000000000001');
    expect(cellsToString({ ...d, cells: ['zz', ...d.cells.slice(1)] })[0]).toBe(CELL_ALPHABET[0]);
  });

  it('lists used colours in palette order', () => {
    expect(usedColorIds(d)).toEqual(['a', 'b', 'c']);
    expect(usedColorIds(removePaletteColor(d, 'b'))).toEqual(['a', 'c']);
  });

  it('removes a colour, turning its cells into background', () => {
    const r = removePaletteColor(d, 'b');
    expect(r.palette.map((c) => c.id)).toEqual(['a', 'c']);
    expect(rowsOf(r)).toEqual(['aaca', 'aaaa', 'aaaa', 'aaaa']);
    expect(removePaletteColor(d, 'a')).toBe(d);
    expect(removePaletteColor(d, 'zzz')).toBe(d);
  });

  it('adds a colour with a suggested or given name', () => {
    const r = addPaletteColor(d, '#00F');
    expect(r.palette).toHaveLength(4);
    expect(r.palette[3]).toMatchObject({ hex: '#0000ff', name: nearestColorName('#0000ff') });
    expect(addPaletteColor(d, '#123456', '  Night  ').palette[3].name).toBe('Night');
    expect(addPaletteColor(d, 'bogus')).toBe(d);
  });

  it('does not exceed MAX_PALETTE', () => {
    let full = d;
    for (let i = 0; i < 40; i++) full = addPaletteColor(full, '#336699');
    expect(full.palette).toHaveLength(MAX_PALETTE);
    expect(new Set(full.palette.map((c) => c.id)).size).toBe(MAX_PALETTE);
  });
});

describe('cloneDesign / copyName', () => {
  it('deep copies with a new id and timestamps', () => {
    const d = { ...fromRows(['abca', 'aaaa', 'aaaa', 'aaab']), createdAt: 1, updatedAt: 2 };
    const c = cloneDesign(d, { name: 'Other' });
    expect(c.id).not.toBe(d.id);
    expect(c.name).toBe('Other');
    expect(c.createdAt).toBeGreaterThan(2);
    expect(c.cells).toEqual(d.cells);
    expect(c.cells).not.toBe(d.cells);
    expect(c.palette[0]).not.toBe(d.palette[0]);
    expect(c.puzzle.ops).not.toBe(d.puzzle.ops);
    expect(cloneDesign(d).name).toBe(d.name);
  });

  it('produces a copy-name sequence', () => {
    const existing = ['Heart'];
    let name = 'Heart';
    const seen: string[] = [];
    for (let i = 0; i < 4; i++) {
      name = copyName('Heart', existing);
      existing.push(name);
      seen.push(name);
    }
    expect(seen).toEqual(['Heart (copy)', 'Heart (copy 2)', 'Heart (copy 3)', 'Heart (copy 4)']);
    expect(copyName('Heart (copy)', [])).toBe('Heart (copy 2)');
    expect(copyName('Heart (copy 2)', ['Heart (copy 3)'])).toBe('Heart (copy 4)');
    expect(copyName('', [])).toBe('Untitled (copy)');
  });

  it('keeps copy names within NAME_MAX', () => {
    const long = 'y'.repeat(NAME_MAX);
    const c = copyName(long, [long]);
    expect(c.length).toBeLessThanOrEqual(NAME_MAX);
    expect(c.endsWith(' (copy)')).toBe(true);
  });

  it('keeps copy names well-formed when truncating emoji', () => {
    const name = 'ab' + SMILE.repeat(29); // exactly NAME_MAX units
    const c = copyName(name, [name]);
    expect(c).toBe('ab' + SMILE.repeat(25) + ' (copy)'); // 53 units left; the 26th emoji would be cut
    expect(c.length).toBeLessThanOrEqual(NAME_MAX);
    expect(() => encodeURIComponent(c)).not.toThrow();
  });
});
