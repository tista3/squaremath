// OWNER: image-core agent. Deterministic synthetic test images for the photo pipeline tests (no DOM).
import { createRng } from '../rng';
import type { RgbaImage } from './types';

export type Rgb = [number, number, number];

export function blank(width: number, height: number, color: Rgb, alpha = 255): RgbaImage {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i++) data.set([color[0], color[1], color[2], alpha], i * 4);
  return { width, height, data };
}

/** Paint every pixel whose centre satisfies `inside(x, y)`. */
export function paint(img: RgbaImage, color: Rgb, inside: (x: number, y: number) => boolean, alpha = 255): RgbaImage {
  for (let y = 0; y < img.height; y++) {
    for (let x = 0; x < img.width; x++) {
      if (inside(x + 0.5, y + 0.5)) img.data.set([color[0], color[1], color[2], alpha], (y * img.width + x) * 4);
    }
  }
  return img;
}

export const disc = (cx: number, cy: number, r: number) => (x: number, y: number) => (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
export const annulus = (cx: number, cy: number, r0: number, r1: number) => (x: number, y: number) => {
  const d2 = (x - cx) ** 2 + (y - cy) ** 2;
  return d2 >= r0 * r0 && d2 <= r1 * r1;
};
export const rect = (x0: number, y0: number, w: number, h: number) => (x: number, y: number) =>
  x >= x0 && x < x0 + w && y >= y0 && y < y0 + h;

/** Adds ±amount uniform noise per pixel (same offset on r, g and b, like JPEG luma noise). */
export function noise(img: RgbaImage, amount: number, seed = 1): RgbaImage {
  const rng = createRng(seed);
  for (let i = 0; i < img.width * img.height; i++) {
    const n = Math.round((rng.next() * 2 - 1) * amount);
    for (let c = 0; c < 3; c++) img.data[i * 4 + c] = img.data[i * 4 + c] + n;
  }
  return img;
}

/** Red disc with a black outline on white (200×160): disc centre (100, 80), radius 50 + 4 px outline. */
export function redCircle(): RgbaImage {
  const img = blank(200, 160, [255, 255, 255]);
  paint(img, [20, 20, 20], disc(100, 80, 54));
  return paint(img, [229, 57, 53], disc(100, 80, 50));
}

/**
 * Blue square (90..210 × 70..170) with a yellow stripe on light grey with a soft vertical gradient
 * (brighter in the middle, like vignetting) and ±6 JPEG-like noise. 300×240.
 */
export function noisySubject(): RgbaImage {
  const img = blank(300, 240, [0, 0, 0]);
  for (let y = 0; y < 240; y++) {
    for (let x = 0; x < 300; x++) {
      const v = Math.round(226 - 14 * (((x - 150) / 150) ** 2 + ((y - 120) / 120) ** 2));
      img.data.set([v, v, v + 2, 255], (y * 300 + x) * 4);
    }
  }
  paint(img, [30, 80, 200], rect(90, 70, 120, 100));
  paint(img, [250, 210, 40], rect(90, 110, 120, 20));
  return noise(img, 6, 7);
}

/** A colourful smooth gradient with no plain border: no background. 256×192. */
export function photoGradient(): RgbaImage {
  const img = blank(256, 192, [0, 0, 0]);
  for (let y = 0; y < 192; y++) {
    for (let x = 0; x < 256; x++) {
      img.data.set([x, Math.round((y / 191) * 255), 255 - x, 255], (y * 256 + x) * 4);
    }
  }
  return noise(img, 3, 3);
}

/**
 * Green ring on white (200×200) — its 80 px hole shows the background — plus a separate green disc with a
 * small white "eye" (r = 4) at (160, 40). Ring centre (80, 110), radii 40..70.
 */
export function ringWithHole(): RgbaImage {
  const img = blank(200, 200, [255, 255, 255]);
  paint(img, [40, 160, 70], annulus(80, 110, 40, 70));
  paint(img, [40, 160, 70], disc(160, 40, 22));
  return paint(img, [255, 255, 255], disc(160, 40, 4));
}

/** Transparent sticker: an orange square (40..120) with a white centre (60..100) on alpha 0. 160×160. */
export function transparentSticker(): RgbaImage {
  const img = blank(160, 160, [0, 0, 0], 0);
  paint(img, [251, 140, 0], rect(40, 40, 80, 80));
  return paint(img, [255, 255, 255], rect(60, 60, 40, 40));
}

/**
 * A drawn sun (integrator regression): yellow disc with a dark-brown outline, two dark eyes, a dark smile,
 * pink cheeks and 12 thin orange rays, on an off-white gradient with light noise. 400×400.
 */
export function drawnSun(): RgbaImage {
  const img = blank(400, 400, [0, 0, 0]);
  for (let y = 0; y < 400; y++) {
    for (let x = 0; x < 400; x++) {
      const v = Math.round(242 - 10 * (y / 400));
      img.data.set([v, v - 4, v - 10, 255], (y * 400 + x) * 4);
    }
  }
  const c = 200;
  for (let k = 0; k < 12; k++) {
    const a = (k * Math.PI) / 6;
    const ux = Math.cos(a), uy = Math.sin(a);
    paint(img, [245, 150, 30], (x, y) => {
      const along = (x - c) * ux + (y - c) * uy;
      const across = Math.abs(-(x - c) * uy + (y - c) * ux);
      return along >= 112 && along <= 170 && across <= 7;
    });
  }
  paint(img, [60, 40, 25], disc(c, c, 100));
  paint(img, [252, 212, 50], disc(c, c, 91));
  paint(img, [60, 40, 25], disc(165, 175, 11));
  paint(img, [60, 40, 25], disc(235, 175, 11));
  paint(img, [60, 40, 25], (x, y) => annulus(c, 205, 36, 45)(x, y) && y > 215);
  paint(img, [240, 120, 140], disc(140, 215, 14));
  paint(img, [240, 120, 140], disc(260, 215, 14));
  return noise(img, 3, 11);
}

// ---------------------------------------------------------------------------------------------
// Grid pictures (worksheet-like): flat cells, grid lines, a printed "sum" in every cell.

export interface GridSpec {
  /** One string per row; each char is a key of `colors`. */
  art: string[];
  colors: Record<string, Rgb>;
  /** Cell size in px (may be fractional). */
  cell: number;
  /** Top-left corner of the grid. */
  x: number;
  y: number;
  line?: Rgb;
  lineWidth?: number;
  /** Outer border width (thicker than the inner lines on many worksheets). */
  border?: number;
  /** Draw a fake printed sum in every cell (dark on light cells, white on dark ones). */
  text?: boolean;
}

const luma = (c: Rgb) => 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2];

/** Draws a grid picture into `img`. */
export function drawGrid(img: RgbaImage, g: GridSpec): RgbaImage {
  const rows = g.art.length;
  const cols = g.art[0].length;
  const lw = g.lineWidth ?? 1;
  const bw = g.border ?? lw;
  const line = g.line ?? [60, 60, 60];
  for (let y = 0; y < img.height; y++) {
    for (let x = 0; x < img.width; x++) {
      const u = (x + 0.5 - g.x) / g.cell;
      const v = (y + 0.5 - g.y) / g.cell;
      const pad = bw / 2 / g.cell;
      if (u < -pad || v < -pad || u > cols + pad || v > rows + pad) continue;
      const nearU = Math.abs(u - Math.round(u)) * g.cell;
      const nearV = Math.abs(v - Math.round(v)) * g.cell;
      const outer = u < pad || v < pad || u > cols - pad || v > rows - pad;
      let c: Rgb;
      if (outer || nearU <= lw / 2 + 1e-6 || nearV <= lw / 2 + 1e-6) {
        c = line;
      } else {
        const cu = Math.min(cols - 1, Math.floor(u));
        const cv = Math.min(rows - 1, Math.floor(v));
        c = g.colors[g.art[cv][cu]];
        if (g.text) {
          // "1+2"-like glyph: three short strokes and a plus bar, centred in the cell.
          const fu = u - cu, fv = v - cv;
          const stroke =
            (fv > 0.38 && fv < 0.62 && ((fu > 0.27 && fu < 0.33) || (fu > 0.67 && fu < 0.73))) ||
            (fv > 0.47 && fv < 0.53 && fu > 0.42 && fu < 0.58) ||
            (fu > 0.47 && fu < 0.53 && fv > 0.43 && fv < 0.57);
          if (stroke) c = luma(c) < 90 ? [235, 235, 235] : [25, 25, 25];
        }
      }
      img.data.set([c[0], c[1], c[2], 255], (y * img.width + x) * 4);
    }
  }
  return img;
}

/** A worksheet-like page: title banner with white "letters", the grid, grey paragraph lines below. */
export function worksheet(width: number, height: number, grids: GridSpec[]): RgbaImage {
  const img = blank(width, height, [255, 255, 255]);
  paint(img, [20, 140, 200], rect(10, 6, width - 20, 22));
  for (let k = 0; k < 12; k++) paint(img, [255, 255, 255], rect(20 + k * 14, 11, 9, 12));
  for (const g of grids) drawGrid(img, g);
  for (let l = 0; l < 2; l++) {
    for (let k = 0; k < 20; k++) paint(img, [110, 110, 110], rect(12 + k * 16, height - 30 + l * 14, 11, 8));
  }
  return img;
}

/** A 16 × 12 heart on sky blue with a black outline. */
export const HEART = {
  art: [
    'bbbbbbbbbbbbbbbb',
    'bbbkkbbbbbbkkbbb',
    'bbkrrkbbbbkrrkbb',
    'bkrrrrkbbkrrrrkb',
    'bkrprrrkkrrrrrkb',
    'bkrrrrrrrrrrrrkb',
    'bbkrrrrrrrrrrkbb',
    'bbbkrrrrrrrrkbbb',
    'bbbbkrrrrrrkbbbb',
    'bbbbbkrrrrkbbbbb',
    'bbbbbbkrrkbbbbbb',
    'bbbbbbbkkbbbbbbb',
  ],
  colors: { b: [12, 174, 234], k: [34, 34, 34], r: [230, 30, 40], p: [255, 190, 210] } as Record<string, Rgb>,
};

/** A 10 × 14 mushroom: red cap with white dots, beige stem, green grass. */
export const MUSHROOM = {
  art: [
    'wwwwwwwwww',
    'wwwrrrrwww',
    'wwrrwrrrww',
    'wrrrrrrwrw',
    'wrwrrrrrrw',
    'rrrrrwrrrr',
    'rrwrrrrrwr',
    'wwwsssswww',
    'wwwsssswww',
    'wwwsssswww',
    'wwwsssswww',
    'wwssssssww',
    'gggggggggg',
    'gggggggggg',
  ],
  colors: { w: [255, 255, 255], r: [200, 20, 30], s: [240, 220, 170], g: [60, 170, 70] } as Record<string, Rgb>,
};
