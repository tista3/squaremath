import { describe, expect, it } from 'vitest';
import { createRng } from '../rng';
import { cutFigure, figureRegion, findFigures } from './figures';
import type { Figure, FigureSheet } from './figures';
import {
  blank,
  disc,
  drawnSun,
  noise,
  noisySubject,
  paint,
  paleCartoon,
  photoGradient,
  rect,
  redCircle,
  ringWithHole,
  shadedCartoon,
  transparentSticker,
} from './fixtures';
import type { Rgb } from './fixtures';
import type { RgbaImage } from './types';

const WHITE: Rgb = [255, 255, 255];
const BLACK: Rgb = [0, 0, 0];
const FILLS: Rgb[] = [
  [230, 90, 70],
  [70, 170, 90],
  [70, 110, 210],
  [235, 200, 60],
];

// fixtures' paint() visits the whole image per call; a sheet has hundreds of small shapes, so these don't.
function fillRect(img: RgbaImage, color: Rgb, x0: number, y0: number, w: number, h: number): void {
  for (let y = Math.max(0, y0); y < Math.min(img.height, y0 + h); y++) {
    for (let x = Math.max(0, x0); x < Math.min(img.width, x0 + w); x++) {
      img.data.set([color[0], color[1], color[2], 255], (y * img.width + x) * 4);
    }
  }
}

function fillDisc(img: RgbaImage, color: Rgb, cx: number, cy: number, r: number): void {
  const inside = disc(cx, cy, r);
  for (let y = Math.max(0, Math.floor(cy - r)); y < Math.min(img.height, Math.ceil(cy + r)); y++) {
    for (let x = Math.max(0, Math.floor(cx - r)); x < Math.min(img.width, Math.ceil(cx + r)); x++) {
      if (inside(x + 0.5, y + 0.5)) img.data.set([color[0], color[1], color[2], 255], (y * img.width + x) * 4);
    }
  }
}

/** A round creature: dark outline, coloured body, two eyes and a light belly. Radius r round (cx, cy). */
function creature(img: RgbaImage, cx: number, cy: number, r: number, fill: Rgb): void {
  fillDisc(img, [40, 30, 35], cx, cy, r);
  fillDisc(img, fill, cx, cy, r - 3);
  fillDisc(img, [250, 235, 215], cx, cy + r * 0.35, r * 0.35);
  for (const side of [-1, 1]) fillDisc(img, [20, 20, 20], cx + side * r * 0.35, cy - r * 0.3, r * 0.12);
}

/** A word of block letters (H, I, L, T shapes), `height` tall, centred on cx with its top at `top`. */
function word(img: RgbaImage, cx: number, top: number, height: number, ink: Rgb = BLACK, letters = 'HILTHI'): void {
  const w = Math.round(height * 0.6);
  const s = Math.max(2, Math.round(height / 6));
  const gap = Math.max(2, Math.round(height / 6));
  let x = Math.round(cx - (letters.length * (w + gap) - gap) / 2);
  for (const ch of letters) {
    const bar = (bx: number, by: number, bw: number, bh: number) => fillRect(img, ink, x + bx, top + by, bw, bh);
    const mid = Math.round((w - s) / 2);
    if (ch === 'H') {
      bar(0, 0, s, height);
      bar(w - s, 0, s, height);
      bar(0, Math.round((height - s) / 2), w, s);
    } else if (ch === 'L') {
      bar(0, 0, s, height);
      bar(0, height - s, w, s);
    } else if (ch === 'T') {
      bar(0, 0, w, s);
      bar(mid, 0, s, height);
    } else {
      bar(mid, 0, s, height);
    }
    x += w + gap;
  }
}

const PITCH_X = 150;
const PITCH_Y = 160;
const R = 45;
const centre = (index: number, cols: number): [number, number] => [
  90 + (index % cols) * PITCH_X,
  80 + Math.floor(index / cols) * PITCH_Y,
];

/** cols × rows creatures, with a caption `captionGap` px under each (none when undefined). */
function creatures(cols: number, rows: number, captionGap?: number, paper: Rgb = WHITE, alpha = 255): RgbaImage {
  const img = blank(cols * PITCH_X + 30, rows * PITCH_Y + 20, paper, alpha);
  for (let i = 0; i < cols * rows; i++) {
    const [cx, cy] = centre(i, cols);
    creature(img, cx, cy, R, FILLS[i % FILLS.length]);
    if (captionGap !== undefined) word(img, cx, cy + R + captionGap, 18);
  }
  return img;
}

function sheetOf(img: RgbaImage): FigureSheet {
  const found = findFigures(img);
  expect(found).not.toBeNull();
  return found!;
}

/** The figure has the box of the creature round (cx, cy), give or take `slack`. */
function expectCreature(f: Figure, cx: number, cy: number, slack = 5): void {
  expect(Math.abs(f.box.x - (cx - R))).toBeLessThanOrEqual(slack);
  expect(Math.abs(f.box.y - (cy - R))).toBeLessThanOrEqual(slack);
  expect(Math.abs(f.box.w - 2 * R)).toBeLessThanOrEqual(2 * slack);
  expect(Math.abs(f.box.h - 2 * R)).toBeLessThanOrEqual(2 * slack);
}

const keeps = ({ box, keep }: Figure, x: number, y: number) =>
  x >= box.x && y >= box.y && x < box.x + box.w && y < box.y + box.h && keep[(y - box.y) * box.w + x - box.x] === 1;

/** Share of a disc's pixels that the figure keeps. */
function keptShare(f: Figure, cx: number, cy: number, r: number): number {
  let all = 0;
  let kept = 0;
  for (let y = Math.floor(cy - r); y <= cy + r; y++) {
    for (let x = Math.floor(cx - r); x <= cx + r; x++) {
      if (!disc(cx, cy, r)(x + 0.5, y + 0.5)) continue;
      all++;
      if (keeps(f, x, y)) kept++;
    }
  }
  return kept / all;
}

describe('findFigures', () => {
  it('finds every drawing in reading order, without the captions', () => {
    const { figures, paper } = sheetOf(creatures(4, 3, 14));
    expect(figures).toHaveLength(12);
    expect(paper).toEqual([255, 255, 255, 255]);
    figures.forEach((f, i) => expectCreature(f, ...centre(i, 4)));
  });

  it('cuts a caption off the feet it runs into', () => {
    const img = creatures(4, 2, 12);
    // The second creature stands lower, so that its feet run into the line of captions.
    const [cx, top] = centre(1, 4);
    const cy = top + 15;
    paint(img, WHITE, rect(cx - 60, top - R - 4, 120, 2 * R + 40));
    creature(img, cx, cy, R, FILLS[1]);
    word(img, cx, top + R + 12, 18);
    const { figures } = sheetOf(img);
    expect(figures).toHaveLength(8);
    expect(keptShare(figures[1], cx, cy, R - 5)).toBeGreaterThan(0.99);
    expect(figures[1].box.y + figures[1].box.h).toBeLessThanOrEqual(cy + R + 6);
  });

  it("does not let a title's line slice the drawings beside it", () => {
    const img = blank(900, 420, WHITE);
    const at: [number, number][] = [[80, 110], [820, 110], [80, 300], [820, 300], [340, 310], [560, 310]];
    at.forEach(([cx, cy], i) => creature(img, cx, cy, R, FILLS[i % FILLS.length]));
    word(img, 450, 82, 56, BLACK, 'HILTH');
    const { figures } = sheetOf(img);
    expect(figures).toHaveLength(6);
    for (const [cx, cy] of at) {
      expect(Math.max(...figures.map((f) => keptShare(f, cx, cy, R - 1)))).toBeGreaterThan(0.99);
    }
  });

  it('does not mistake shaded grey drawings standing in a row for writing', () => {
    const img = blank(6 * 104 + 40, 320, WHITE);
    const rng = createRng(3);
    for (let i = 0; i < 6; i++) {
      const cx = 70 + i * 104;
      for (let y = 22; y < 118; y++) {
        for (let x = cx - 46; x < cx + 46; x++) {
          if (!disc(cx, 70, 44)(x + 0.5, y + 0.5)) continue;
          const v = 60 + (y - 22) * 1.3 + rng.next() * 8;
          img.data.set([v, v, v + 4, 255], (y * img.width + x) * 4);
        }
      }
      creature(img, cx, 230, 44, FILLS[i % FILLS.length]);
    }
    expect(sheetOf(img).figures).toHaveLength(12);
  });

  it('keeps a nearly white part of a drawing', () => {
    const img = creatures(3, 1);
    const [cx, cy] = centre(1, 3);
    // Below the middle: almost paper, with no outline.
    paint(img, WHITE, (x, y) => disc(cx, cy, R + 1)(x, y) && y > cy);
    paint(img, [245, 246, 247], (x, y) => disc(cx, cy, R)(x, y) && y > cy);
    const { figures } = sheetOf(img);
    expect(figures).toHaveLength(3);
    expectCreature(figures[1], cx, cy);
  });

  it('gives a floating part to the figure beside it', () => {
    const img = creatures(3, 1);
    const [cx, cy] = centre(0, 3);
    paint(img, [200, 120, 220], disc(cx + R + 9, cy, 7));
    const { figures } = sheetOf(img);
    expect(figures).toHaveLength(3);
    expect(keeps(figures[0], cx + R + 9, cy)).toBe(true);
  });

  it('looks inside frames', () => {
    const img = creatures(3, 2);
    for (let i = 0; i < 6; i++) {
      const [cx, cy] = centre(i, 3);
      const outer = rect(cx - 66, cy - 66, 132, 132);
      const inner = rect(cx - 64, cy - 64, 128, 128);
      paint(img, [90, 90, 90], (x, y) => outer(x, y) && !inner(x, y));
    }
    const { figures } = sheetOf(img);
    expect(figures).toHaveLength(6);
    figures.forEach((f, i) => expectCreature(f, ...centre(i, 3)));
  });

  it('works on coloured and on transparent paper', () => {
    const tinted = sheetOf(creatures(3, 2, 14, [214, 232, 240]));
    expect(tinted.figures).toHaveLength(6);
    expect(tinted.paper).toEqual([214, 232, 240, 255]);
    const clear = sheetOf(creatures(3, 2, 14, BLACK, 0));
    expect(clear.figures).toHaveLength(6);
    expect(clear.paper[3]).toBe(0);
  });

  it('finds black line drawings with captions', () => {
    const img = blank(3 * 170 + 20, 2 * 190, WHITE);
    for (let i = 0; i < 6; i++) {
      const cx = 95 + (i % 3) * 170;
      const cy = 85 + Math.floor(i / 3) * 190;
      paint(img, BLACK, disc(cx, cy, 60));
      paint(img, WHITE, disc(cx, cy, 56));
      for (const side of [-1, 1]) {
        paint(img, BLACK, disc(cx + side * 22, cy - 14, 8));
        paint(img, BLACK, disc(cx + side * 38, cy - 64, 12));
      }
      paint(img, BLACK, rect(cx - 20, cy + 22, 40, 4));
      word(img, cx, cy + 72, 18);
    }
    expect(sheetOf(img).figures).toHaveLength(6);
  });

  it.each([
    ['red circle', redCircle],
    ['noisy subject', noisySubject],
    ['photo gradient', photoGradient],
    ['ring with hole and a dot', ringWithHole],
    ['transparent sticker', transparentSticker],
    ['drawn sun', drawnSun],
    ['shaded cartoon', shadedCartoon],
    ['pale cartoon', paleCartoon],
    ['texture', () => noise(blank(200, 160, [128, 128, 128]), 90, 4)],
    ['blank page', () => blank(300, 200, WHITE)],
    ['one pixel', () => blank(1, 1, WHITE)],
    ['no pixels', (): RgbaImage => ({ width: 1000, height: 600, data: new Uint8ClampedArray(0) })],
  ] as [string, () => RgbaImage][])('is no sheet: %s', (_, make) => {
    expect(findFigures(make())).toBeNull();
  });

  it('is no sheet: a page of writing', () => {
    const img = blank(500, 300, WHITE);
    for (let line = 0; line < 6; line++) {
      for (let w = 0; w < 3; w++) word(img, 90 + w * 160, 20 + line * 44, 22);
    }
    expect(findFigures(img)).toBeNull();
  });

  it('is no sheet: one drawing with its name', () => {
    const img = blank(240, 260, WHITE);
    creature(img, 120, 110, 80, FILLS[0]);
    word(img, 120, 210, 24);
    expect(findFigures(img)).toBeNull();
  });
});

describe('cutFigure', () => {
  it('paints neighbours and writing over with paper, with a margin all round', () => {
    const img = creatures(3, 1, 14);
    const [cx, cy] = centre(1, 3);
    // A neighbour reaching into the middle creature's box.
    paint(img, [10, 160, 160], disc(cx - R - 1, cy - R + 2, 9));
    const sheet = sheetOf(img);
    const f = sheet.figures[1];
    const cut = cutFigure(figureRegion(img, f), sheet, f);
    const margin = (cut.width - f.box.w) / 2;
    expect(margin).toBeGreaterThanOrEqual(2);
    expect([...cut.data.subarray(0, 4)]).toEqual([255, 255, 255, 255]);
    const at = (x: number, y: number) => [...cut.data.subarray((y * cut.width + x) * 4, (y * cut.width + x) * 4 + 3)];
    expect(at(cx - f.box.x + margin, cy - 5 - f.box.y + margin)).toEqual(FILLS[1]);
    expect(cut.height).toBeLessThan(2 * R + 12 + 2 * margin);
  });

  it('works on a region from a higher resolution', () => {
    const img = creatures(3, 1, 14);
    const sheet = sheetOf(img);
    const f = sheet.figures[0];
    const small = figureRegion(img, f);
    const big = blank(small.width * 3, small.height * 3, WHITE);
    for (let y = 0; y < big.height; y++) {
      for (let x = 0; x < big.width; x++) {
        const from = (Math.floor(y / 3) * small.width + Math.floor(x / 3)) * 4;
        big.data.set(small.data.subarray(from, from + 4), (y * big.width + x) * 4);
      }
    }
    const cut = cutFigure(big, sheet, f);
    expect(cut.width).toBeGreaterThan(big.width);
    const mid = ((cut.height >> 1) - 12) * cut.width + (cut.width >> 1);
    expect([...cut.data.subarray(mid * 4, mid * 4 + 3)]).toEqual(FILLS[0]);
  });
});
