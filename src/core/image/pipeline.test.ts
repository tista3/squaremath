import { describe, expect, it } from 'vitest';
import { nearestColorName, rankedColorNames, CRAYONS } from '../colors';
import { normalizeDesign } from '../design';
import { generatePuzzle, maxColorsFor } from '../puzzle';
import { GRID_MAX, GRID_MIN, MAX_PALETTE } from '../types';
import { backgroundMask, derive, downscale } from './analyze';
import { hexToLab } from './color';
import { sanitizeParams, smooth } from './convert';
import {
  blank,
  drawnSun,
  noise,
  noisySubject,
  paint,
  photoGradient,
  rect,
  redCircle,
  ringWithHole,
  transparentSticker,
} from './fixtures';
import { uniqueColorNames } from './naming';
import {
  DEFAULT_PARAMS,
  PRESET_IDS,
  analyzeImage,
  conversionToDesign,
  convertImage,
  suggestPresets,
} from './pipeline';
import { COLOR_ALGORITHMS, CROP_MODES, PARAM_LIMITS, WORKING_SIZE } from './types';
import type { Conversion, ConvertParams, ImageAnalysis, RgbaImage } from './types';

const lightness = (hex: string) => hexToLab(hex)[0];
const isNearWhite = (hex: string) => [1, 3, 5].every((i) => parseInt(hex.slice(i, i + 2), 16) >= 0xf0);

/** Structural validity of a conversion (everything a Design needs). */
function expectValid(conv: Conversion, params?: ConvertParams): void {
  expect(conv.width).toBeGreaterThanOrEqual(GRID_MIN);
  expect(conv.width).toBeLessThanOrEqual(GRID_MAX);
  expect(conv.height).toBeGreaterThanOrEqual(GRID_MIN);
  expect(conv.height).toBeLessThanOrEqual(GRID_MAX);
  expect(conv.cells).toHaveLength(conv.width * conv.height);
  expect(conv.palette.length).toBeGreaterThanOrEqual(1);
  expect(conv.palette.length).toBeLessThanOrEqual(MAX_PALETTE);
  if (params) expect(conv.palette.length).toBeLessThanOrEqual(params.colors + (conv.backgroundRemoved ? 1 : 0));
  for (const c of conv.palette) {
    expect(c.hex).toMatch(/^#[0-9a-f]{6}$/);
    expect(c.name.length).toBeGreaterThan(0);
  }
  const names = conv.palette.map((c) => c.name.toLowerCase());
  expect(new Set(names).size).toBe(names.length);
  expect(new Set(conv.palette.map((c) => c.hex)).size).toBe(conv.palette.length);
  const used = new Set(conv.cells);
  for (const i of conv.cells) expect(i >= 0 && i < conv.palette.length).toBe(true);
  conv.palette.forEach((_, i) => {
    if (!(conv.backgroundRemoved && i === 0)) expect(used.has(i)).toBe(true);
  });
  if (conv.backgroundRemoved) {
    expect(conv.palette[0]).toEqual({ name: 'White', hex: '#ffffff' });
    expect(names.slice(1)).not.toContain('white');
  }
}

/** Every pixel of a fresh image copy (the derived-data cache is keyed by object, so this bypasses it). */
function copy(img: RgbaImage): RgbaImage {
  return { width: img.width, height: img.height, data: new Uint8ClampedArray(img.data) };
}

function expectPuzzleReady(conv: Conversion): void {
  const design = conversionToDesign(conv, 'Test picture');
  expect(normalizeDesign(JSON.parse(JSON.stringify(design)))).toEqual(design);
  const result = generatePuzzle(design);
  expect(result.ok).toBe(true);
  expect(design.puzzle.blankBackground).toBe(conv.backgroundRemoved);
  const counts = new Map<string, number>();
  for (const id of design.cells) counts.set(id, (counts.get(id) ?? 0) + 1);
  const puzzleColors = [...counts.keys()].filter((id) => !(conv.backgroundRemoved && id === design.backgroundId)).length;
  expect(maxColorsFor(design.puzzle)).toBeGreaterThanOrEqual(puzzleColors);
}

const FIXTURES: [string, () => RgbaImage][] = [
  ['red circle', redCircle],
  ['noisy subject', noisySubject],
  ['photo gradient', photoGradient],
  ['ring with hole', ringWithHole],
  ['transparent sticker', transparentSticker],
  ['drawn sun', drawnSun],
];

describe('analyzeImage', () => {
  it('finds the white background, the circle and a graphic look', () => {
    const a = analyzeImage(redCircle());
    expect(a.background).not.toBeNull();
    expect(isNearWhite(a.background!)).toBe(true);
    // Circle (with outline) spans 46..154 × 26..134.
    expect(Math.abs(a.subjectBox.x - 46)).toBeLessThanOrEqual(3);
    expect(Math.abs(a.subjectBox.y - 26)).toBeLessThanOrEqual(3);
    expect(Math.abs(a.subjectBox.w - 108)).toBeLessThanOrEqual(5);
    expect(Math.abs(a.subjectBox.h - 108)).toBeLessThanOrEqual(5);
    expect(a.kind).toBe('graphic');
    expect(a.suggestedColors).toBeGreaterThanOrEqual(PARAM_LIMITS.colors.min);
    expect(a.suggestedColors).toBeLessThanOrEqual(4);
  });

  it('copes with JPEG-like noise and a vignetted backdrop', () => {
    const a = analyzeImage(noisySubject());
    expect(a.background).not.toBeNull();
    expect(lightness(a.background!)).toBeGreaterThan(80);
    expect(Math.abs(a.subjectBox.x - 90)).toBeLessThanOrEqual(4);
    expect(Math.abs(a.subjectBox.y - 70)).toBeLessThanOrEqual(4);
    expect(Math.abs(a.subjectBox.w - 120)).toBeLessThanOrEqual(6);
    expect(Math.abs(a.subjectBox.h - 100)).toBeLessThanOrEqual(6);
  });

  it('reports no background for a photo-like gradient and boxes the whole image', () => {
    const a = analyzeImage(photoGradient());
    expect(a.background).toBeNull();
    expect(a.subjectBox).toEqual({ x: 0, y: 0, w: 256, h: 192 });
    expect(a.kind).toBe('photo');
    expect(a.suggestedColors).toBeGreaterThanOrEqual(5);
    expect(a.suggestedColors).toBeLessThanOrEqual(PARAM_LIMITS.colors.max);
  });

  it('treats transparent pixels as background, even next to white subject pixels', () => {
    const a = analyzeImage(transparentSticker());
    expect(a.background).toBe('#ffffff');
    expect(a.subjectBox).toEqual({ x: 40, y: 40, w: 80, h: 80 });
    const mask = backgroundMask(derive(a.image), a.background!, 30);
    expect(mask[100 * 160 + 80]).toBe(0); // the white centre stays subject
    expect(mask[10 * 160 + 10]).toBe(1);
  });

  it('downscales large images to WORKING_SIZE with an area average', () => {
    const img = blank(1024, 600, [0, 0, 0]);
    paint(img, [255, 255, 255], (x, y) => (Math.floor(x) + Math.floor(y)) % 2 === 0); // checkerboard
    const small = downscale(img);
    expect(small.width).toBe(WORKING_SIZE);
    expect(small.height).toBe(300);
    for (const i of [0, 1000, 70000]) expect(Math.abs(small.data[i * 4] - 128)).toBeLessThanOrEqual(2);
    expect(analyzeImage(img).image.width).toBe(WORKING_SIZE);
  });

  it('handles a 1×1 image and a uniform image', () => {
    for (const img of [blank(1, 1, [200, 30, 30]), blank(64, 48, [90, 160, 220])]) {
      const a = analyzeImage(img);
      expect(a.background).toBeNull();
      expect(a.subjectBox).toEqual({ x: 0, y: 0, w: img.width, h: img.height });
      for (const p of suggestPresets(a)) {
        const conv = convertImage(a, p.params);
        expectValid(conv);
        expect(conv.palette).toHaveLength(1);
        expectPuzzleReady(conv);
      }
    }
  });
});

describe('background mask: holes', () => {
  // Rule: an enclosed region is subject unless it has the background colour AND covers ≥ 2 % of the
  // subject's bounding box (a see-through hole). Small enclosed background-coloured patches stay subject.
  it('removes a large see-through hole but keeps a small enclosed eye', () => {
    const a = analyzeImage(ringWithHole());
    const mask = backgroundMask(derive(a.image), a.background!, 30);
    const at = (x: number, y: number) => mask[y * a.image.width + x];
    expect(at(80, 110)).toBe(1); // ring centre: background
    expect(at(80, 155)).toBe(0); // ring body
    expect(at(160, 40)).toBe(0); // the eye stays part of the subject
    expect(at(5, 5)).toBe(1);
  });

  it('does not remove a large enclosed region of a different colour', () => {
    const img = blank(200, 200, [255, 255, 255]);
    paint(img, [40, 40, 40], rect(40, 40, 120, 120));
    paint(img, [250, 230, 120], rect(60, 60, 80, 80)); // pale yellow inside a dark frame
    const a = analyzeImage(img);
    const mask = backgroundMask(derive(a.image), a.background!, 30);
    expect(mask[100 * 200 + 100]).toBe(0);
  });
});

describe('convertImage', () => {
  it('turns the red circle into red + dark outline on a removed White background', () => {
    const a = analyzeImage(redCircle());
    const params = { ...DEFAULT_PARAMS, width: 24, colors: 4 };
    const conv = convertImage(a, params);
    expectValid(conv, params);
    expect(conv.backgroundRemoved).toBe(true);
    const names = conv.palette.map((c) => c.name);
    expect(names.some((n) => /red/i.test(n))).toBe(true);
    expect(conv.palette.some((c) => lightness(c.hex) < 25)).toBe(true);
    expect(conv.cells[0]).toBe(0);
    expect(conv.cells[conv.cells.length - 1]).toBe(0);
    const centre = conv.cells[Math.floor(conv.height / 2) * conv.width + Math.floor(conv.width / 2)];
    expect(conv.palette[centre].name).toMatch(/red/i);
  });

  it('keeps the background as a colour when removal is off', () => {
    const a = analyzeImage(redCircle());
    const conv = convertImage(a, { ...DEFAULT_PARAMS, removeBackground: false, crop: 'full' });
    expectValid(conv);
    expect(conv.backgroundRemoved).toBe(false);
    expect(isNearWhite(conv.palette[conv.cells[0]].hex)).toBe(true);
    expect(conv.palette.filter((c) => c.name === 'White').length).toBeLessThanOrEqual(1);
  });

  it('names a near-white subject colour something other than White when the background is removed', () => {
    const img = blank(120, 120, [40, 90, 200]);
    paint(img, [250, 250, 250], rect(30, 30, 60, 60));
    paint(img, [20, 20, 20], rect(50, 50, 20, 20));
    const a = analyzeImage(img);
    expect(a.background).not.toBeNull();
    for (const algorithm of COLOR_ALGORITHMS) {
      const conv = convertImage(a, { ...DEFAULT_PARAMS, algorithm, colors: 3, width: 16 });
      expectValid(conv);
      const subject = conv.palette.slice(1);
      expect(subject.some((c) => lightness(c.hex) > 85)).toBe(true);
      expect(subject.every((c) => c.hex !== '#ffffff')).toBe(true);
    }
  });

  it('works for every algorithm × crop × sampling and stays within the limits', () => {
    for (const make of [redCircle, noisySubject, photoGradient]) {
      const a = analyzeImage(make());
      for (const algorithm of COLOR_ALGORITHMS)
        for (const crop of CROP_MODES)
          for (const sampling of ['average', 'dominant'] as const)
            for (const colors of [2, 5, 12]) {
              const params = { ...DEFAULT_PARAMS, algorithm, crop, sampling, colors, width: 18 };
              const conv = convertImage(a, params);
              expectValid(conv, params);
              expect(conv.width).toBe(18);
            }
    }
  });

  it('crops: square gives a square grid, full keeps the image aspect, subject follows the subject', () => {
    const a = analyzeImage(noisySubject());
    const square = convertImage(a, { ...DEFAULT_PARAMS, crop: 'square', width: 20 });
    expect(square.height).toBe(20);
    const full = convertImage(a, { ...DEFAULT_PARAMS, crop: 'full', width: 20 });
    expect(full.height).toBe(16); // 300×240
    const subject = convertImage(a, { ...DEFAULT_PARAMS, crop: 'subject', width: 24 });
    expect(Math.abs(subject.height - Math.round((24 * 112) / 132))).toBeLessThanOrEqual(2);
    // Subject crop: background only on a thin margin, so the subject fills most of the grid.
    const subjectCells = subject.cells.filter((c) => c !== 0).length;
    expect(subjectCells / subject.cells.length).toBeGreaterThan(0.6);
  });

  it('clamps rows for extreme aspect ratios', () => {
    const tall = analyzeImage(noise(blank(20, 400, [120, 60, 30]), 20));
    const conv = convertImage(tall, { ...DEFAULT_PARAMS, crop: 'full', width: 30 });
    expect(conv.height).toBe(GRID_MAX);
    const wide = analyzeImage(noise(blank(400, 10, [120, 60, 30]), 20));
    expect(convertImage(wide, { ...DEFAULT_PARAMS, crop: 'full', width: 10 }).height).toBe(GRID_MIN);
  });

  it('uses exact crayon colours and names with the crayon algorithm', () => {
    const a = analyzeImage(redCircle());
    const conv = convertImage(a, { ...DEFAULT_PARAMS, algorithm: 'crayon', colors: 3 });
    expectValid(conv);
    const crayon = conv.palette.slice(1);
    expect(crayon.map((c) => c.name)).toContain('Red');
    expect(crayon.find((c) => c.name === 'Red')!.hex).toBe('#e53935');
  });

  it('cleans speckles with smoothing', () => {
    const img = blank(200, 200, [40, 160, 70]);
    // Salt-and-pepper: scattered single dark pixels-sized blocks of one cell each (10 px at 20 cells).
    for (let k = 0; k < 12; k++) paint(img, [200, 200, 60], rect(10 + ((k * 37) % 170), 10 + ((k * 53) % 170), 10, 10));
    const a = analyzeImage(img);
    const params = { ...DEFAULT_PARAMS, crop: 'full' as const, width: 20, colors: 2, sampling: 'dominant' as const };
    const raw = convertImage(a, { ...params, smoothing: 0 });
    const clean = convertImage(a, { ...params, smoothing: 1 });
    const minority = (c: Conversion) => {
      const counts = new Map<number, number>();
      for (const v of c.cells) counts.set(v, (counts.get(v) ?? 0) + 1);
      return Math.min(...counts.values());
    };
    expect(raw.palette.length).toBe(2);
    expect(minority(clean)).toBeLessThanOrEqual(minority(raw));
  });

  it('is deterministic', () => {
    for (const [, make] of FIXTURES) {
      const a1 = analyzeImage(make());
      const a2 = analyzeImage(make());
      expect({ ...a2, image: null }).toEqual({ ...a1, image: null });
      for (const p of suggestPresets(a1)) expect(convertImage(a2, p.params)).toEqual(convertImage(a1, p.params));
    }
  });

  it('sanitises out-of-range parameters', () => {
    const p = sanitizeParams({
      ...DEFAULT_PARAMS,
      width: 999,
      colors: -3,
      smoothing: 9,
      saturation: NaN,
      contrast: 400,
      backgroundTolerance: -1,
      algorithm: 'nope' as never,
      crop: 'zoom' as never,
    });
    expect(p).toMatchObject({ width: GRID_MAX, colors: 2, smoothing: 3, saturation: 0, contrast: 50, backgroundTolerance: 0 });
    expect(p.algorithm).toBe('kmeans');
    expect(p.crop).toBe('subject');
    const a = analyzeImage(redCircle());
    expectValid(convertImage(a, { ...DEFAULT_PARAMS, width: 999, colors: 999 }));
  });

  it('is fast: 40×40 from a WORKING_SIZE image in ≲ 50 ms', () => {
    const src = blank(WORKING_SIZE, WORKING_SIZE, [235, 235, 230]);
    for (let y = 0; y < WORKING_SIZE; y++)
      for (let x = 0; x < WORKING_SIZE; x++)
        if ((x - 256) ** 2 + (y - 256) ** 2 < 200 ** 2)
          src.data.set([x >> 1, y >> 1, (x + y) >> 2, 255], (y * WORKING_SIZE + x) * 4);
    noise(src, 5, 9);
    const a = analyzeImage(src);
    expect(a.image.width).toBe(WORKING_SIZE);
    const params = { ...DEFAULT_PARAMS, width: 40, colors: 12, crop: 'full' as const };
    const t0 = performance.now();
    convertImage(a, params); // cold: also builds the per-image caches and the mask
    const cold = performance.now() - t0;
    const times: number[] = [];
    for (let i = 0; i < 5; i++) {
      const s = performance.now();
      convertImage(a, { ...params, colors: 11 + (i % 2), saturation: i });
      times.push(performance.now() - s);
    }
    const s2 = performance.now();
    convertImage(a, { ...params, backgroundTolerance: 41 }); // new mask
    const newMask = performance.now() - s2;
    times.sort((x, y) => x - y);
    const median = times[2];
    console.info(`convertImage 40×40 @${WORKING_SIZE}px: cold ${cold.toFixed(1)} ms, warm median ${median.toFixed(1)} ms, new tolerance ${newMask.toFixed(1)} ms`);
    expect(median).toBeLessThan(50);
    expect(newMask).toBeLessThan(150);
  });
});

describe('suggestPresets', () => {
  it.each(FIXTURES)('%s: 4–6 distinct presets, each puzzle-ready', (_, make) => {
    const a = analyzeImage(make());
    const presets = suggestPresets(a);
    expect(presets.length).toBeGreaterThanOrEqual(4);
    expect(presets.length).toBeLessThanOrEqual(6);
    const ids = presets.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(PRESET_IDS).toContain(id);
    expect(new Set(presets.map((p) => JSON.stringify(p.params))).size).toBe(presets.length);
    if (a.background === null) {
      expect(ids).not.toContain('whole');
      for (const p of presets) expect(convertImage(a, p.params).backgroundRemoved).toBe(false);
    } else {
      expect(ids).toContain('whole');
    }
    for (const p of presets) {
      expect(sanitizeParams(p.params)).toEqual(p.params);
      const conv = convertImage(a, p.params);
      expectValid(conv, p.params);
      expectPuzzleReady(conv);
    }
  });

  it('keeps thin rays and small dark features of a drawing in every preset (regression)', () => {
    const a = analyzeImage(drawnSun());
    expect(a.background).not.toBeNull();
    for (const p of suggestPresets(a)) {
      const conv = convertImage(a, p.params);
      const picture = conv.palette.filter((_, i) => !(conv.backgroundRemoved && i === 0));
      expect(picture.length, p.id).toBeGreaterThanOrEqual(3);
      expect(picture.some((c) => lightness(c.hex) < 35), `${p.id}: dark features`).toBe(true);
      expect(picture.some((c) => /orange|gold|yellow/i.test(c.name)), p.id).toBe(true);
    }
  });
});

describe('conversionToDesign', () => {
  const conversion = (backgroundRemoved: boolean, colors: number): Conversion => {
    const palette = backgroundRemoved ? [{ name: 'White', hex: '#ffffff' }] : [];
    for (let i = 0; i < colors; i++) palette.push({ name: CRAYONS[5 + i].name, hex: CRAYONS[5 + i].hex });
    const cells = Array.from({ length: 100 }, (_, i) => (i < 50 ? 0 : i % palette.length));
    return { width: 10, height: 10, palette, cells, backgroundRemoved };
  };

  it('uses White as the blank background when it was removed', () => {
    const d = conversionToDesign(conversion(true, 12), '  My  photo ');
    expect(d.name).toBe('My  photo');
    expect(d.backgroundId).toBe(d.palette[0].id);
    expect(d.puzzle.blankBackground).toBe(true);
    expect(d.puzzle.ops).toEqual(['add', 'sub']);
    expect(maxColorsFor(d.puzzle)).toBeGreaterThanOrEqual(12);
    expect(generatePuzzle(d).ok).toBe(true);
    expect(normalizeDesign(JSON.parse(JSON.stringify(d)))).toEqual(d);
  });

  it('keeps every colour puzzled and picks the most frequent as background otherwise', () => {
    const conv = conversion(false, 3);
    const d = conversionToDesign(conv, '');
    expect(d.name).toBe('Untitled');
    expect(d.puzzle.blankBackground).toBe(false);
    expect(d.backgroundId).toBe(d.palette[0].id); // index 0 fills half the grid
    expect(new Set(d.palette.map((c) => c.id)).size).toBe(d.palette.length);
    expect(generatePuzzle(d).ok).toBe(true);
    const seeds = new Set(Array.from({ length: 5 }, () => conversionToDesign(conv, 'x').puzzle.seed));
    expect(seeds.size).toBeGreaterThan(1);
  });
});

describe('colour names', () => {
  it('rankedColorNames starts with nearestColorName', () => {
    for (const hex of ['#123456', '#fefefe', '#ff8800', '#7f7f7f', ...CRAYONS.map((c) => c.hex)]) {
      const ranked = rankedColorNames(hex);
      expect(ranked[0].name).toBe(nearestColorName(hex));
      expect(ranked).toHaveLength(CRAYONS.length);
      for (let i = 1; i < ranked.length; i++) expect(ranked[i].distance).toBeGreaterThanOrEqual(ranked[i - 1].distance);
    }
  });

  it('gives the best fit the plain name and keeps every name unique', () => {
    const names = uniqueColorNames(['#e53935', '#d32f2f', '#c62828', '#e53935'.replace('35', '36')]);
    expect(names[0]).toBe('Red');
    expect(new Set(names.map((n) => n.toLowerCase())).size).toBe(4);
  });

  it('never reuses a reserved name and stays unique for many similar colours', () => {
    const greys = Array.from({ length: 24 }, (_, i) => {
      const v = (232 + i).toString(16);
      return `#${v}${v}${v}`;
    });
    const names = uniqueColorNames(greys, ['White']);
    expect(names).not.toContain('White');
    expect(new Set(names.map((n) => n.toLowerCase())).size).toBe(24);
    expect(names.every((n) => n.length > 0 && n.length <= 60)).toBe(true);
  });
});

describe('smooth', () => {
  const run = (rows: string[], passes = 1) => {
    const W = rows[0].length;
    const H = rows.length;
    const grid = Int32Array.from(rows.join(''), (ch) => (ch === '.' ? -1 : Number(ch)));
    const labs: [number, number, number][] = [[50, 60, 40], [30, 0, 0], [90, -5, 80], [54, 52, 36]]; // 3 = a near shade of 0
    const out = smooth(grid, W, H, labs.length, (v) => (v < 0 ? [100, 0, 0] : labs[v]), passes);
    const text: string[] = [];
    for (let y = 0; y < H; y++) text.push(Array.from(out.slice(y * W, (y + 1) * W), (v) => (v < 0 ? '.' : String(v))).join(''));
    return text;
  };

  it('removes a lonely cell and an isolated pair of similar colour', () => {
    expect(run(['00000', '00300', '00000', '00000'])).toEqual(['00000', '00000', '00000', '00000']);
    expect(run(['000000', '003300', '000000', '000000'])).toEqual(['000000', '000000', '000000', '000000']);
  });

  it('keeps 1-cell lines, also diagonal ones', () => {
    const line = ['......', '111111', '......', '......'];
    expect(run(line, 3)).toEqual(line);
    const diag = ['1.....', '.1....', '..1...', '...1..', '....1.'];
    expect(run(diag, 3)).toEqual(diag);
  });

  it('keeps a strongly contrasting lonely feature (an eye) but removes background specks', () => {
    expect(run(['22222', '22122', '22222'])).toEqual(['22222', '22122', '22222']);
    expect(run(['.....', '..1..', '.....'])).toEqual(['.....', '.....', '.....']);
  });
});

describe('analysis inputs are not mutated', () => {
  it('leaves the caller image untouched', () => {
    const img = redCircle();
    const before = copy(img);
    const a: ImageAnalysis = analyzeImage(img);
    convertImage(a, DEFAULT_PARAMS);
    expect(img).toEqual(before);
    expect(a.image.data).not.toBe(img.data);
  });
});
