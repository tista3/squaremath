import { describe, expect, it } from 'vitest';
import { normalizeDesign } from '../design';
import { generatePuzzle } from '../puzzle';
import { downscale } from './analyze';
import { hexToRgb } from './color';
import {
  HEART,
  MUSHROOM,
  blank,
  drawGrid,
  drawnSun,
  noise,
  noisySubject,
  paint,
  photoGradient,
  redCircle,
  ringWithHole,
  transparentSticker,
  worksheet,
} from './fixtures';
import type { GridSpec, Rgb } from './fixtures';
import { detectGrids } from './grid';
import { DEFAULT_PARAMS, analyzeImage, conversionToDesign, convertImage, suggestPresets } from './pipeline';
import { SOURCE_SIZE } from './types';
import type { DetectedGrid, RgbaImage } from './types';

/** Every detected cell colour is within `tol` (per channel) of the drawn one, and the colour count is exact. */
function expectCells(g: DetectedGrid, art: string[], colors: Record<string, Rgb>, tol = 10): void {
  expect(g.cols).toBe(art[0].length);
  expect(g.rows).toBe(art.length);
  const used = new Set(art.join(''));
  expect(new Set(g.cells).size).toBe(used.size);
  const byChar = new Map<string, string>();
  art.join('').split('').forEach((ch, i) => {
    const got = hexToRgb(g.cells[i]);
    const want = colors[ch];
    for (let c = 0; c < 3; c++) expect(Math.abs(got[c] - want[c]), `cell ${i} (${ch})`).toBeLessThanOrEqual(tol);
    // Same drawn colour → same detected colour (merged).
    if (byChar.has(ch)) expect(g.cells[i]).toBe(byChar.get(ch));
    else byChar.set(ch, g.cells[i]);
  });
}

const heartSpec = (extra: Partial<GridSpec> = {}): GridSpec => ({ ...HEART, cell: 14, x: 30, y: 40, text: true, ...extra });

describe('detectGrids', () => {
  it.each([
    ['round figures', 20, (u: number, v: number) => u * u + v * v <= 0.48 ** 2],
    ['crosses', 16, (u: number, v: number) => Math.min(Math.abs(u), Math.abs(v)) <= 0.14 && Math.max(Math.abs(u), Math.abs(v)) <= 0.42],
  ] as const)('does not take %s lined up in rows (a character sheet) for a grid', (_, pitch, inside) => {
    const count = 8;
    const img = paint(blank(pitch * count + 40, pitch * count + 40, [255, 255, 255]), [40, 40, 50], (x, y) => {
      const a = (x - 20) / pitch;
      const b = (y - 20) / pitch;
      return a >= 0 && b >= 0 && a < count && b < count && inside((a % 1) - 0.5, (b % 1) - 0.5);
    });
    expect(detectGrids(img)).toEqual([]);
  });

  it('reads a worksheet grid exactly despite the printed sums, title and text', () => {
    const img = worksheet(300, 260, [heartSpec()]);
    const grids = detectGrids(img);
    expect(grids).toHaveLength(1);
    expectCells(grids[0], HEART.art, HEART.colors);
    expect(grids[0].confidence).toBeGreaterThan(0.7);
    const { box } = grids[0];
    expect(Math.abs(box.x - 30)).toBeLessThanOrEqual(2);
    expect(Math.abs(box.y - 40)).toBeLessThanOrEqual(2);
    expect(Math.abs(box.w - 16 * 14)).toBeLessThanOrEqual(3);
    expect(Math.abs(box.h - 12 * 14)).toBeLessThanOrEqual(3);
  });

  it('handles fractional cell sizes, thick outer borders and black cells next to dark lines', () => {
    const img = worksheet(320, 280, [heartSpec({ cell: 13.4, line: [20, 20, 20], border: 3, x: 41.3, y: 47.7 })]);
    const [g] = detectGrids(img);
    expect(g).toBeDefined();
    expectCells(g, HEART.art, HEART.colors);
  });

  it('finds two grids side by side, largest first', () => {
    const img = worksheet(520, 300, [
      heartSpec({ cell: 12, x: 20, y: 50 }),
      { ...MUSHROOM, cell: 16, x: 300, y: 40, text: true, line: [90, 90, 90] },
    ]);
    const grids = detectGrids(img);
    expect(grids).toHaveLength(2);
    // Mushroom 160 × 224 px is larger than the heart 192 × 144 px.
    expectCells(grids[0], MUSHROOM.art, MUSHROOM.colors);
    expectCells(grids[1], HEART.art, HEART.colors);
  });

  it('survives scaling blur and JPEG-like noise', () => {
    const big = worksheet(600, 520, [heartSpec({ cell: 28, x: 60, y: 80, lineWidth: 2 })]);
    const small = noise(downscale(big, 390), 4, 5); // 0.65×: 18.2 px cells, ~1.3 px soft lines
    const [g] = detectGrids(small);
    expect(g).toBeDefined();
    expectCells(g, HEART.art, HEART.colors, 14);
  });

  it('reports boxes in the input pixels when the input is larger than SOURCE_SIZE', () => {
    const img = blank(SOURCE_SIZE + 600, 700, [255, 255, 255]);
    drawGrid(img, { ...HEART, cell: 30, x: 1200, y: 100, text: true });
    const [g] = detectGrids(img);
    expect(g).toBeDefined();
    expectCells(g, HEART.art, HEART.colors, 14);
    expect(Math.abs(g.box.x - 1200)).toBeLessThanOrEqual(4);
    expect(Math.abs(g.box.w - 480)).toBeLessThanOrEqual(6);
  });

  it('finds no grid in photos and drawings', () => {
    for (const make of [redCircle, noisySubject, photoGradient, ringWithHole, transparentSticker, drawnSun]) {
      expect(detectGrids(make()), make.name).toEqual([]);
    }
    expect(detectGrids(blank(1, 1, [0, 0, 0]))).toEqual([]);
    expect(detectGrids(blank(300, 200, [240, 240, 240]))).toEqual([]);
  });

  it('rejects grids outside GRID_MIN..GRID_MAX or with stretched cells', () => {
    const tiny = { art: ['ab', 'ba'], colors: { a: [255, 0, 0], b: [0, 0, 255] } as Record<string, Rgb>, cell: 30, x: 20, y: 20 };
    expect(detectGrids(drawGrid(blank(120, 120, [255, 255, 255]), tiny))).toEqual([]);
    const huge = { art: Array.from({ length: 10 }, () => 'ab'.repeat(23)), colors: tiny.colors, cell: 8, x: 4, y: 4 };
    expect(detectGrids(drawGrid(blank(380, 90, [255, 255, 255]), huge))).toEqual([]);
  });
});

describe('grid conversion', () => {
  const analysis = (img: RgbaImage) => analyzeImage(img);

  it('takes the grid 1:1 with all its colours and named, puzzle-ready', () => {
    const a = analysis(worksheet(300, 260, [heartSpec()]));
    const conv = convertImage(a, { ...DEFAULT_PARAMS, source: 'grid', gridIndex: 0, colors: 12, removeBackground: false });
    expect(conv.width).toBe(16);
    expect(conv.height).toBe(12);
    expect(conv.backgroundRemoved).toBe(false);
    expect(conv.palette).toHaveLength(4);
    const names = conv.palette.map((c) => c.name);
    expect(new Set(names).size).toBe(4);
    HEART.art.join('').split('').forEach((ch, i) => {
      const got = hexToRgb(conv.palette[conv.cells[i]].hex);
      HEART.colors[ch].forEach((v, c) => expect(Math.abs(got[c] - v)).toBeLessThanOrEqual(10));
    });
    const d = conversionToDesign(conv, 'Heart');
    expect(normalizeDesign(JSON.parse(JSON.stringify(d)))).toEqual(d);
    expect(d.puzzle.blankBackground).toBe(false);
    expect(generatePuzzle(d).ok).toBe(true);
  });

  it('turns the most common border colour into the White background on request', () => {
    const a = analysis(worksheet(300, 260, [heartSpec()]));
    const conv = convertImage(a, { ...DEFAULT_PARAMS, source: 'grid', removeBackground: true, colors: 12 });
    expect(conv.backgroundRemoved).toBe(true);
    expect(conv.palette[0]).toEqual({ name: 'White', hex: '#ffffff' });
    expect(conv.palette).toHaveLength(4); // White + black + red + pink
    expect(conv.cells[0]).toBe(0);
    const bgCells = HEART.art.join('').split('').filter((ch) => ch === 'b').length;
    expect(conv.cells.filter((c) => c === 0)).toHaveLength(bgCells);
    expect(generatePuzzle(conversionToDesign(conv, 'Heart')).ok).toBe(true);
  });

  it('reduces extra colours with the chosen algorithm', () => {
    const a = analysis(worksheet(300, 260, [heartSpec()]));
    for (const algorithm of ['kmeans', 'median-cut', 'posterize', 'crayon'] as const) {
      const conv = convertImage(a, { ...DEFAULT_PARAMS, source: 'grid', algorithm, colors: 2, removeBackground: false });
      expect(conv.width).toBe(16);
      expect(conv.palette.length).toBeLessThanOrEqual(2);
      expect(conv.cells).toHaveLength(16 * 12);
    }
  });

  it('falls back to pixelation when the grid index does not exist', () => {
    const a = analysis(redCircle());
    expect(a.grids).toEqual([]);
    const conv = convertImage(a, { ...DEFAULT_PARAMS, source: 'grid', gridIndex: 3 });
    expect(conv.width).toBe(DEFAULT_PARAMS.width);
  });

  it('puts one preset per grid first', () => {
    const a = analysis(
      worksheet(520, 300, [heartSpec({ cell: 12, x: 20, y: 50 }), { ...MUSHROOM, cell: 16, x: 300, y: 40, text: true }]),
    );
    expect(a.grids).toHaveLength(2);
    const presets = suggestPresets(a);
    expect(presets.slice(0, 2).map((p) => p.id)).toEqual(['grid', 'grid-2']);
    expect(presets[0].params).toMatchObject({ source: 'grid', gridIndex: 0, colors: 4, removeBackground: false });
    expect(presets[1].params).toMatchObject({ source: 'grid', gridIndex: 1, colors: 4 });
    expect(presets.slice(2).every((p) => p.params.source === 'pixelate')).toBe(true);
    for (const p of presets) {
      const conv = convertImage(a, p.params);
      const d = conversionToDesign(conv, p.id);
      expect(normalizeDesign(JSON.parse(JSON.stringify(d)))).toEqual(d);
      expect(generatePuzzle(d).ok).toBe(true);
    }
    const mushroom = convertImage(a, presets[0].params);
    expect([mushroom.width, mushroom.height]).toEqual([10, 14]);
  });
});
