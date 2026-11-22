import { describe, expect, it } from 'vitest';
import { createRng } from '../rng';
import { GRID_MAX, GRID_MIN } from '../types';
import { derive } from './analyze';
import { hexToLab } from './color';
import { drawingMask } from './drawing';
import { annulus, blank, noise, paint, paleCartoon, photoGradient, shadedCartoon } from './fixtures';
import { DEFAULT_PARAMS, analyzeImage, convertImage, suggestPresets } from './pipeline';
import { fills } from './quantize';
import { blackHat, boxMeans, stepsTo } from './raster';
import { CELL_SAMPLINGS, COLOR_ALGORITHMS } from './types';
import type { Conversion, ConvertParams, ImageAnalysis, RgbaImage } from './types';

const DRAWING: ConvertParams = { ...DEFAULT_PARAMS, sampling: 'drawing', algorithm: 'fills' };

function convert(img: RgbaImage, params: Partial<ConvertParams> = {}): { a: ImageAnalysis; conv: Conversion } {
  const a = analyzeImage(img);
  return { a, conv: convertImage(a, { ...DRAWING, ...params }) };
}

/** Lab of every cell whose colour is not the blank background. */
function cellColours(conv: Conversion): [number, number, number][] {
  return conv.cells.filter((i) => !(conv.backgroundRemoved && i === 0)).map((i) => hexToLab(conv.palette[i].hex));
}

describe('drawing detection', () => {
  it('recognises a softly shaded, noisy cartoon as a drawing', () => {
    const a = analyzeImage(shadedCartoon());
    expect(a.kind).toBe('graphic');
    expect(a.background).toBe('#ffffff');
  });

  it('recognises a nearly white cartoon and boxes all of it', () => {
    const a = analyzeImage(paleCartoon());
    expect(a.kind).toBe('graphic');
    const { x, y, w, h } = a.subjectBox;
    for (const [got, want] of [[x, 30], [y, 30], [w, 140], [h, 140]]) expect(Math.abs(got - want)).toBeLessThanOrEqual(2);
  });

  it('leaves photos alone, also cut out on white', () => {
    expect(analyzeImage(photoGradient()).kind).toBe('photo');
    // A textured, many-coloured disc: continuous tones, as many light as dark specks.
    const img = blank(240, 240, [255, 255, 255]);
    const rng = createRng(9);
    for (let y = 0; y < 240; y++) {
      for (let x = 0; x < 240; x++) {
        if ((x - 120) ** 2 + (y - 120) ** 2 > 95 ** 2) continue;
        const n = rng.next() * 70 - 35;
        img.data.set([x + n, y * 0.8 + n, 200 - x * 0.6 + n, 255], (y * 240 + x) * 4);
      }
    }
    expect(analyzeImage(img).kind).toBe('photo');
  });

  it('gives drawings the drawing sampling in every layout, and photos none of it', () => {
    for (const p of suggestPresets(analyzeImage(shadedCartoon()))) {
      expect(p.params.sampling).toBe('drawing');
      expect(p.params.algorithm).toBe(p.id === 'crayon' ? 'crayon' : 'fills');
    }
    for (const p of suggestPresets(analyzeImage(photoGradient()))) {
      expect(p.params.sampling).not.toBe('drawing');
      expect(p.params.algorithm).not.toBe('fills');
    }
  });
});

describe('drawing mask', () => {
  it('does not leak into a pale body', () => {
    const a = analyzeImage(paleCartoon());
    const mask = drawingMask(derive(a.image), a.background!, 30);
    let lost = 0;
    let total = 0;
    for (let y = 0; y < 200; y++) {
      for (let x = 0; x < 200; x++) {
        if ((x + 0.5 - 100) ** 2 + (y + 0.5 - 100) ** 2 > 68 ** 2) continue;
        total++;
        lost += mask[y * 200 + x];
      }
    }
    expect(lost).toBeLessThan(total * 0.01);
    expect(mask[5 * 200 + 5]).toBe(1);
  });

  it('opens a see-through hole of exactly the paper colour', () => {
    const img = paint(blank(200, 200, [255, 255, 255]), [40, 120, 200], annulus(100, 100, 40, 70));
    const { conv } = convert(img, { width: 20, colors: 3 });
    expect(conv.cells[Math.floor(conv.height / 2) * conv.width + Math.floor(conv.width / 2)]).toBe(0);
  });
});

describe('drawing sampling', () => {
  it.each([14, 20, 32])('keeps both eyes at %i squares across', (width) => {
    const { conv } = convert(shadedCartoon(), { width, colors: 5 });
    const { cells, palette, width: W, height: H } = conv;
    // Dark cells with no blank neighbour are inside the body, not on the outline: look left and right of the middle.
    const inner: number[] = [];
    for (let y = 1; y < H / 2; y++) {
      for (let x = 1; x < W - 1; x++) {
        const c = y * W + x;
        if (cells[c] === 0 || [c - 1, c + 1, c - W, c + W].some((n) => cells[n] === 0)) continue;
        if (hexToLab(palette[cells[c]].hex)[0] < 35) inner.push(x / W);
      }
    }
    expect(inner.some((x) => x < 0.45)).toBe(true);
    expect(inner.some((x) => x > 0.45)).toBe(true);
  });

  it.each([14, 20, 32])('keeps the small pink cheeks at %i squares across', (width) => {
    const { conv } = convert(shadedCartoon(), { width, colors: 5 });
    const pink = cellColours(conv).filter(([, a]) => a > 30);
    expect(pink.length).toBeGreaterThanOrEqual(2);
  });

  it.each([14, 20, 32])('outlines a pale body so it stands out from the blank paper at %i squares across', (width) => {
    const { conv } = convert(paleCartoon(), { width, colors: 4 });
    const { cells, palette, width: W, height: H } = conv;
    let edge = 0;
    let outlined = 0;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const c = y * W + x;
        if (cells[c] === 0) continue;
        const open =
          x === 0 || y === 0 || x === W - 1 || y === H - 1 || [c - 1, c + 1, c - W, c + W].some((n) => cells[n] === 0);
        if (!open) continue;
        edge++;
        if (hexToLab(palette[cells[c]].hex)[0] < 78) outlined++;
      }
    }
    expect(edge).toBeGreaterThan(0);
    expect(outlined / edge).toBeGreaterThanOrEqual(0.9);
    // …and the inside is filled.
    expect(cells[Math.floor(H / 2) * W + Math.floor(W / 2)]).not.toBe(0);
  });

  it('is deterministic, with or without cached features', () => {
    const { a, conv } = convert(shadedCartoon(), { width: 26 });
    convertImage(a, { ...DRAWING, width: 11 });
    expect(convertImage(a, { ...DRAWING, width: 26 })).toEqual(conv);
    expect(convert(shadedCartoon(), { width: 26 }).conv).toEqual(conv);
  });

  it('keeps the whole picture when the background is kept', () => {
    const { conv } = convert(shadedCartoon(), { removeBackground: false, crop: 'full', width: 22 });
    expect(conv.backgroundRemoved).toBe(false);
    expect(conv.height).toBe(20);
    expect(hexToLab(conv.palette[conv.cells[0]].hex)[0]).toBeGreaterThan(95);
  });

  const transparent = () => blank(30, 30, [0, 0, 0], 0);
  const transparentDot = () => paint(transparent(), [200, 0, 0], (x, y) => x > 12 && x < 18 && y > 12 && y < 18);
  const EDGE_CASES: [string, () => RgbaImage][] = [
    ['one pixel', () => blank(1, 1, [200, 30, 30])],
    ['3 × 5', () => paint(blank(3, 5, [255, 255, 255]), [0, 0, 0], (x) => x < 2)],
    ['uniform', () => blank(64, 48, [255, 255, 255])],
    ['fully transparent', transparent],
    ['dot on transparent', transparentDot],
    ['very wide', () => paint(blank(300, 8, [255, 255, 255]), [0, 0, 200], (x, y) => x > 4 && x < 296 && y > 2 && y < 6)],
    ['noisy', () => noise(blank(50, 70, [128, 128, 128]), 90, 2)],
  ];

  it.each(EDGE_CASES)('gives a valid picture for every setting: %s', (_, make) => {
    const a = analyzeImage(make());
    for (const width of [GRID_MIN, 17, GRID_MAX]) {
      for (const algorithm of COLOR_ALGORITHMS) {
        for (const removeBackground of [true, false]) {
          for (const smoothing of [0, 1, 3]) {
            const conv = convertImage(a, { ...DRAWING, width, algorithm, removeBackground, smoothing, colors: 4, saturation: 20 });
            expect(conv.height).toBeGreaterThanOrEqual(GRID_MIN);
            expect(conv.height).toBeLessThanOrEqual(GRID_MAX);
            expect(conv.cells).toHaveLength(conv.width * conv.height);
            expect(conv.cells.every((c) => c >= 0 && c < conv.palette.length)).toBe(true);
            expect(conv.palette.every((c) => /^#[0-9a-f]{6}$/.test(c.hex))).toBe(true);
            expect(conv.palette.length).toBeLessThanOrEqual(4 + (conv.backgroundRemoved ? 1 : 0));
          }
        }
      }
    }
  });

  it('offers every sampling to the tuner', () => {
    expect([...CELL_SAMPLINGS].sort()).toEqual(['average', 'dominant', 'drawing']);
  });
});

describe('fills palette', () => {
  it('keeps a small accent instead of a second shade of the main fill', () => {
    // Two shades of green (much of the picture) and a little pink.
    const lab = Float64Array.from([70, -40, 30, 58, -38, 28, 65, 55, 10]);
    const q = fills({ lab, weight: Float64Array.from([500, 400, 40]), count: 3 }, 2);
    expect(q.labels[0]).toBe(q.labels[1]);
    expect(q.labels[2]).not.toBe(q.labels[0]);
  });
});

describe('raster filters match their definitions', () => {
  const W = 17;
  const H = 11;
  const rng = createRng(4);
  const src = Float32Array.from({ length: W * H }, () => Math.round(rng.next() * 100));
  const around = (x: number, y: number, r: number, fn: (i: number) => void) => {
    for (let v = Math.max(0, y - r); v <= Math.min(H - 1, y + r); v++) {
      for (let u = Math.max(0, x - r); u <= Math.min(W - 1, x + r); u++) fn(v * W + u);
    }
  };

  it.each([0, 1, 2, 5, 8, 30])('blackHat with radius %i', (r) => {
    const max = src.map((_, i) => {
      let v = -Infinity;
      around(i % W, Math.floor(i / W), r, (j) => (v = Math.max(v, src[j])));
      return v;
    });
    const want = src.map((s, i) => {
      let v = Infinity;
      around(i % W, Math.floor(i / W), r, (j) => (v = Math.min(v, max[j])));
      return v - s;
    });
    expect(Array.from(blackHat(src, W, H, r))).toEqual(Array.from(want));
  });

  it.each([0, 1, 2, 5, 8, 30])('boxMeans with radius %i', (r) => {
    const three = Float32Array.from({ length: W * H * 3 }, (_, i) => src[Math.floor(i / 3)] + (i % 3));
    const got = boxMeans(three, W, H)(r);
    for (let i = 0; i < W * H; i++) {
      let sum = 0;
      let count = 0;
      around(i % W, Math.floor(i / W), r, (j) => {
        sum += src[j];
        count++;
      });
      for (let c = 0; c < 3; c++) expect(got[i * 3 + c]).toBeCloseTo(sum / count + c, 3);
    }
  });

  it('stepsTo', () => {
    const set = Uint8Array.from(src, (v) => (v > 92 ? 1 : 0));
    const got = stepsTo(set, W, H, 9);
    for (let i = 0; i < W * H; i++) {
      let best = 9;
      for (let j = 0; j < W * H; j++) {
        if (!set[j]) continue;
        best = Math.min(best, Math.max(Math.abs((i % W) - (j % W)), Math.abs(Math.floor(i / W) - Math.floor(j / W))));
      }
      expect(got[i]).toBe(best);
    }
  });
});
