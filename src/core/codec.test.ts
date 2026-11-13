import { compressToEncodedURIComponent } from 'lz-string';
import { describe, expect, it } from 'vitest';
import { buildShareUrl, decodeDesign, encodeDesign } from './codec';
import { addPaletteColor, createBlankDesign, normalizeDesign } from './design';
import { createRng } from './rng';
import { MAX_PALETTE, NAME_MAX } from './types';
import type { Design } from './types';

/** Design with ids replaced by palette indexes and timestamps dropped, for content comparison. */
function content(d: Design) {
  const index = new Map(d.palette.map((c, i) => [c.id, i]));
  return {
    name: d.name,
    width: d.width,
    height: d.height,
    palette: d.palette.map((c) => [c.name, c.hex]),
    background: index.get(d.backgroundId),
    cells: d.cells.map((id) => index.get(id)),
    puzzle: d.puzzle,
    print: d.print,
  };
}

/** Pseudo-random but deterministic test picture. */
function sampleDesign(width: number, height: number, colors: number): Design {
  let d = createBlankDesign({ name: 'Test – ÄÖ ÷ 😀', width, height });
  const hexes = ['#123456', '#abcdef', '#ff8800', '#00aa44', '#5500ff', '#c0ffee'];
  d = { ...d, palette: d.palette.slice(0, Math.min(colors, d.palette.length)) };
  for (let i = d.palette.length; i < colors; i++) d = addPaletteColor(d, hexes[i % hexes.length], `Colour ${i}`);
  const ids = d.palette.map((c) => c.id);
  const cells = d.cells.map((_, i) => ids[(i * 7 + Math.floor(i / width) * 3) % ids.length]);
  return {
    ...d,
    backgroundId: ids[1],
    cells,
    puzzle: { ops: ['sub', 'div'], addSubMax: 345, mulDivMax: 12, legendMode: 'value', seed: 4000000000 },
    print: {
      paper: 'Letter',
      orientation: 'landscape',
      divSymbol: ':',
      mulSymbol: '·',
      showTitle: false,
      includeSolution: true,
      legendSwatches: true,
    },
  };
}

describe('share codec', () => {
  it('round-trips all content except ids and timestamps', () => {
    const d = sampleDesign(16, 12, 6);
    const back = decodeDesign(encodeDesign(d))!;
    expect(back).not.toBeNull();
    expect(content(back)).toEqual(content(d));
    expect(normalizeDesign(back)).toEqual(back);
    expect(back.palette.map((c) => c.id)).toEqual(['c0', 'c1', 'c2', 'c3', 'c4', 'c5']);
    expect([back.createdAt, back.updatedAt]).toEqual([0, 0]);
  });

  it('round-trips a maximal design', () => {
    const d = sampleDesign(40, 40, 24);
    expect(content(decodeDesign(encodeDesign(d))!)).toEqual(content(d));
  });

  it('produces URL-safe payloads with a version prefix', () => {
    for (const d of [sampleDesign(16, 16, 6), sampleDesign(40, 40, 24), createBlankDesign()]) {
      const payload = encodeDesign(d);
      expect(payload.startsWith('1~')).toBe(true);
      expect(payload).toMatch(/^[A-Za-z0-9+$~-]+$/);
    }
  });

  it('derives a deterministic id from the payload', () => {
    const payload = encodeDesign(sampleDesign(10, 10, 4));
    const a = decodeDesign(payload)!;
    const b = decodeDesign(payload)!;
    expect(a.id).toMatch(/^shared-[0-9a-z]+$/);
    expect(a).toEqual(b);
    const other = decodeDesign(encodeDesign({ ...sampleDesign(10, 10, 4), name: 'Different' }))!;
    expect(other.id).not.toBe(a.id);
  });

  it('accepts percent-encoded payloads', () => {
    const payload = encodeDesign(sampleDesign(8, 8, 3));
    expect(decodeDesign(encodeURIComponent(payload))).toEqual(decodeDesign(payload));
  });

  it('returns null for garbage', () => {
    const wrap = (v: unknown) => '1~' + compressToEncodedURIComponent(JSON.stringify(v));
    const bad = [
      '',
      'hello',
      '1~',
      '1~!!!!',
      '2~' + encodeDesign(createBlankDesign()).slice(2),
      '1~' + 'A'.repeat(100),
      '%E0%A4%A',
      wrap(null),
      wrap({ a: 1 }),
      wrap([1, 2, 3]),
      wrap(['x', 4, 4, 'notArray', 0, '0000']),
      wrap(['x', 'w', 4, [['A', 'fff']], 0, '0']),
      wrap(['x', 4, 4, [], 0, '0000']),
      '1~' + 'x'.repeat(100_000),
    ];
    for (const p of bad) expect(decodeDesign(p)).toBeNull();
    expect(decodeDesign(undefined as unknown as string)).toBeNull();
  });

  it('repairs partially valid payloads', () => {
    const wrap = (v: unknown) => '1~' + compressToEncodedURIComponent(JSON.stringify(v));
    const d = decodeDesign(wrap(['Hi', 4, 4, [['Red', 'e53935'], [5, 'zz']], 9, '01Z', 'x', [9, 9, 9, 9, 'f']]))!;
    expect(d).not.toBeNull();
    expect(d.backgroundId).toBe('c0');
    expect(d.cells.slice(0, 4)).toEqual(['c0', 'c1', 'c0', 'c0']);
    expect(d.palette[1].hex).toMatch(/^#[0-9a-f]{6}$/);
  });

  it('builds an absolute share URL from the current location', () => {
    const d = sampleDesign(8, 8, 3);
    const url = buildShareUrl(d);
    expect(url).toBe(`${window.location.origin}${window.location.pathname}#/s/${encodeDesign(d)}`);
  });

  it('round-trips the worst legitimate case well inside the decoder limits', () => {
    // 40×40 random cells, 24 colours, 60-char non-Latin names.
    const rng = createRng(7);
    const cjk = (n: number) => Array.from({ length: n }, () => String.fromCharCode(rng.int(0x4e00, 0x9fff))).join('');
    let d = createBlankDesign({ name: cjk(NAME_MAX), width: 40, height: 40 });
    d = { ...d, palette: d.palette.slice(0, 1) };
    while (d.palette.length < MAX_PALETTE) d = addPaletteColor(d, `#${rng.int(0, 0xffffff).toString(16).padStart(6, '0')}`, cjk(NAME_MAX));
    const ids = d.palette.map((c) => c.id);
    d = { ...d, palette: d.palette.map((c) => ({ ...c, name: cjk(NAME_MAX) })), cells: d.cells.map(() => rng.pick(ids)) };
    const payload = encodeDesign(d);
    expect(payload.length).toBeLessThan(15_000);
    expect(content(decodeDesign(payload)!)).toEqual(content(d));
  });

  it('rejects decompression bombs', () => {
    const bomb = '1~' + compressToEncodedURIComponent('['.repeat(400_000));
    expect(bomb.length).toBeLessThan(5_000);
    expect(decodeDesign(bomb)).toBeNull();
  });

  it('keeps payloads short', () => {
    const small = encodeDesign(sampleDesign(16, 16, 6)).length;
    const large = encodeDesign(sampleDesign(40, 40, 24)).length;
    expect(small).toBeLessThan(2000);
    expect(large).toBeLessThan(MAX_URL_FRIENDLY);
  });
});

/** Comfortable limit for links pasted into chat apps / browsers. */
const MAX_URL_FRIENDLY = 8000;
