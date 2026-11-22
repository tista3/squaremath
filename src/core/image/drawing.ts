// OWNER: image-core agent. Drawn pictures (cartoons, character art, clip art): pixel features, mask, detection.
//
// Drawings differ from photos in ways the photo path gets wrong:
// - the paper is perfectly even, and pale fills (a white belly, a wing) are only a few ΔE away from it, so the
//   background is a strict flood on unblurred colours instead of a drift-following flood on blurred ones;
// - antialiasing leaves a pale fringe around the subject, which must not vote for cell colours;
// - soft cel shading and JPEG noise look like a photo to a colour histogram, so detection also looks at how
//   few colours the fills have and whether thin features are mostly dark (strokes) rather than light.
import type { Derived } from './analyze';
import { hexToLab, linearToLab } from './color';
import { kmeans } from './quantize';
import { blackHat, boxMeans, forEach4, stepsTo } from './raster';

/** p90 distance (CIE76) of the border from the background colour up to which paper counts as perfectly even. */
const CLEAN_PAPER = 2.5;
/** …and up to which the strict drawing mask is usable (beyond: gradients, vignettes → the photo mask). */
const EVEN_PAPER = 6;
/** Flood radius (CIE76) at the default tolerance: at least MIN, growing with paper noise, at most MAX. */
const FLOOD_MIN = 4;
const FLOOD_MAX = 14;
/** The default background tolerance, at which the flood radius above applies unscaled. */
const NEUTRAL_TOLERANCE = 30;
/** An enclosed patch of exactly the paper colour is left blank from this share of the subject's box. */
const HOLE_SHARE = 0.01;
/** Detection: mean distance of fill pixels from their 8 main colours that is certainly a drawing… */
const FLAT_RESIDUAL = 3.5;
/** …or up to this, when at least INK_ASYMMETRY of the thin features are dark rather than light. */
const SHADED_RESIDUAL = 8;
const INK_ASYMMETRY = 0.64;
/** A step (CIE76) between neighbours below this is inside a fill. */
const FILL_STEP = 14;
/** A thin feature is this much (L*) darker or lighter than both sides. */
const THIN_FEATURE_STEP = 12;

/** Lazily computed, cached pixel features of one working image. */
export interface DrawingPixels {
  /** Unblurred Lab, 3 per pixel. */
  lab: Float32Array;
  /** Largest CIE76 step to a 4-neighbour. */
  step: Float32Array;
  /** Colour key per pixel, 5 bits per channel. */
  key: Uint16Array;
  /** Black-hat response of L* for radius r. */
  stroke(r: number): Float32Array;
  /** Local mean Lab for radius r. */
  local(r: number): Float32Array;
  paperNoise: Map<string, number>;
  masks: Map<string, Uint8Array>;
}

const pixelCache = new WeakMap<Derived, DrawingPixels>();

export function drawingPixels(d: Derived): DrawingPixels {
  const hit = pixelCache.get(d);
  if (hit) return hit;
  const { w, h, n, lin, rgb } = d;
  const lab = new Float32Array(n * 3);
  const key = new Uint16Array(n);
  for (let i = 0; i < n; i++) {
    const o = i * 3;
    linearToLab(lin[o], lin[o + 1], lin[o + 2], lab, o);
    key[i] = ((rgb[o] >> 3) << 10) | ((rgb[o + 1] >> 3) << 5) | (rgb[o + 2] >> 3);
  }
  const step = new Float32Array(n);
  const link = (i: number, j: number) => {
    const dl = lab[i * 3] - lab[j * 3], da = lab[i * 3 + 1] - lab[j * 3 + 1], db = lab[i * 3 + 2] - lab[j * 3 + 2];
    const v = Math.sqrt(dl * dl + da * da + db * db);
    if (v > step[i]) step[i] = v;
    if (v > step[j]) step[j] = v;
  };
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (x < w - 1) link(i, i + 1);
      if (y < h - 1) link(i, i + w);
    }
  }
  let lightness: Float32Array | null = null;
  let means: ((r: number) => Float32Array) | null = null;
  const strokes = new Map<number, Float32Array>();
  const locals = new Map<number, Float32Array>();
  // A few radii are enough: they only change with the grid width.
  const cached = (map: Map<number, Float32Array>, r: number, make: () => Float32Array) => {
    let value = map.get(r);
    if (value) return value;
    value = make();
    if (map.size >= 10) map.delete(map.keys().next().value as number);
    map.set(r, value);
    return value;
  };
  const px: DrawingPixels = {
    lab,
    step,
    key,
    stroke: (r) =>
      cached(strokes, r, () => {
        if (!lightness) {
          lightness = new Float32Array(n);
          for (let i = 0; i < n; i++) lightness[i] = lab[i * 3];
        }
        return blackHat(lightness, w, h, r);
      }),
    local: (r) =>
      cached(locals, r, () => {
        means ??= boxMeans(lab, w, h);
        return means(r);
      }),
    paperNoise: new Map(),
    masks: new Map(),
  };
  pixelCache.set(d, px);
  return px;
}

// ---------------------------------------------------------------------------------------------
// Paper and mask

/** p90 CIE76 distance of the image border from the background colour (0 for a transparent background). */
function paperNoise(d: Derived, bgHex: string): number {
  if (d.transparentBg) return 0;
  const px = drawingPixels(d);
  const hit = px.paperNoise.get(bgHex);
  if (hit !== undefined) return hit;
  const { w, h, opaque } = d;
  const [bl, ba, bb] = hexToLab(bgHex);
  const found: number[] = [];
  const add = (i: number) => {
    if (opaque[i]) found.push(Math.hypot(px.lab[i * 3] - bl, px.lab[i * 3 + 1] - ba, px.lab[i * 3 + 2] - bb));
  };
  for (let x = 0; x < w; x++) {
    add(x);
    add((h - 1) * w + x);
  }
  for (let y = 0; y < h; y++) {
    add(y * w);
    add(y * w + w - 1);
  }
  found.sort((a, b) => a - b);
  const noise = found.length ? found[Math.floor(found.length * 0.9)] : 0;
  px.paperNoise.set(bgHex, noise);
  return noise;
}

export function hasEvenPaper(d: Derived, bgHex: string): boolean {
  return paperNoise(d, bgHex) <= EVEN_PAPER;
}

export function hasCleanPaper(d: Derived, bgHex: string): boolean {
  return paperNoise(d, bgHex) < CLEAN_PAPER;
}

/**
 * 1 = background. A flood from the image border over pixels within a small radius of the paper colour
 * (raw colours: blurring would dissolve one-pixel outlines and leak into pale fills), plus big enclosed
 * patches of exactly the paper colour (between an arm and the body, the middle of a ring).
 */
export function drawingMask(d: Derived, bgHex: string, tolerance: number): Uint8Array {
  const px = drawingPixels(d);
  const id = `${bgHex}|${Math.round(tolerance * 100)}`;
  const hit = px.masks.get(id);
  if (hit) return hit;
  const { w, h, n, opaque } = d;
  const mask = new Uint8Array(n);
  for (let i = 0; i < n; i++) if (!opaque[i]) mask[i] = 1;

  if (!d.transparentBg && tolerance > 0) {
    const noise = paperNoise(d, bgHex);
    const radius = (Math.min(FLOOD_MAX, Math.max(FLOOD_MIN, noise * 2 + 2)) * tolerance) / NEUTRAL_TOLERANCE;
    const holeRadius = Math.min(radius, 2 + noise);
    const [bl, ba, bb] = hexToLab(bgHex);
    const dist = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const dl = px.lab[i * 3] - bl, da = px.lab[i * 3 + 1] - ba, db = px.lab[i * 3 + 2] - bb;
      dist[i] = Math.sqrt(dl * dl + da * da + db * db);
    }
    const seen = new Uint8Array(n);
    const queue = new Int32Array(n);
    let tail = 0;
    let limit = radius;
    const visit = (i: number) => {
      if (seen[i] || (opaque[i] && dist[i] > limit)) return;
      seen[i] = 1;
      queue[tail++] = i;
    };
    for (let x = 0; x < w; x++) {
      visit(x);
      visit((h - 1) * w + x);
    }
    for (let y = 0; y < h; y++) {
      visit(y * w);
      visit(y * w + w - 1);
    }
    for (let head = 0; head < tail; head++) forEach4(queue[head], w, h, visit);

    let x0 = w, y0 = h, x1 = -1, y1 = -1;
    for (let i = 0; i < n; i++) {
      if (seen[i]) {
        mask[i] = 1;
      } else if (!mask[i]) {
        const x = i % w;
        const y = (i / w) | 0;
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
    if (x1 >= 0) {
      const minArea = Math.max(4, (x1 - x0 + 1) * (y1 - y0 + 1) * HOLE_SHARE);
      limit = holeRadius;
      for (let s = 0; s < n; s++) {
        if (seen[s] || mask[s] || dist[s] > holeRadius) continue;
        tail = 0;
        visit(s);
        for (let head = 0; head < tail; head++) forEach4(queue[head], w, h, visit);
        if (tail >= minArea) for (let k = 0; k < tail; k++) mask[queue[k]] = 1;
      }
    }
  }

  if (px.masks.size >= 8) px.masks.delete(px.masks.keys().next().value as string);
  px.masks.set(id, mask);
  return mask;
}

// ---------------------------------------------------------------------------------------------
// Drawing or photo?

/**
 * True for drawn art on clean paper, including soft-shaded, JPEG-compressed cartoons: either the fills use
 * very few colours, or they use fairly few AND the thin features are mostly dark strokes (in photos thin
 * dark and thin light details are about equally common). `mask` = drawingMask of the image.
 */
export function looksDrawn(d: Derived, mask: Uint8Array): boolean {
  const { w, h, n } = d;
  const { lab, step, key } = drawingPixels(d);

  // Residual of the fill pixels from their 8 main colours (clustered on a colour histogram, for speed).
  const binOf = new Int32Array(32768);
  const sums: number[] = [];
  const weights: number[] = [];
  for (let i = 0; i < n; i++) {
    if (mask[i] || step[i] >= FILL_STEP) continue;
    let b = binOf[key[i]] - 1;
    if (b < 0) {
      b = weights.length;
      binOf[key[i]] = b + 1;
      weights.push(0);
      sums.push(0, 0, 0);
    }
    weights[b]++;
    for (let a = 0; a < 3; a++) sums[b * 3 + a] += lab[i * 3 + a];
  }
  let residual = 0;
  if (weights.length) {
    const points = {
      lab: Float64Array.from(sums, (v, i) => v / weights[(i / 3) | 0]),
      weight: Float64Array.from(weights),
      count: weights.length,
    };
    const { centres, labels } = kmeans(points, 8, 1);
    let count = 0;
    for (let i = 0; i < n; i++) {
      if (mask[i] || step[i] >= FILL_STEP) continue;
      const c = labels[binOf[key[i]] - 1] * 3;
      const dl = lab[i * 3] - centres[c], da = lab[i * 3 + 1] - centres[c + 1], db = lab[i * 3 + 2] - centres[c + 2];
      residual += Math.sqrt(dl * dl + da * da + db * db);
      count++;
    }
    residual /= count;
  }
  if (residual < FLAT_RESIDUAL) return true;
  if (residual >= SHADED_RESIDUAL) return false;

  // Thin features two pixels across: how many are darker than both sides, how many lighter?
  const inside = stepsTo(mask, w, h, 2);
  let measured = 0;
  let dark = 0;
  let light = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (mask[i]) continue;
      if (inside[i] >= 2) measured++;
      if (x < 2 || y < 2 || x >= w - 2 || y >= h - 2) continue;
      const L = lab[i * 3];
      for (let axis = 0; axis < 2; axis++) {
        const s = axis === 0 ? 2 : 2 * w;
        if (mask[i - s] || mask[i + s]) continue;
        const p = lab[(i - s) * 3];
        const q = lab[(i + s) * 3];
        if (L < Math.min(p, q) - THIN_FEATURE_STEP) {
          dark++;
          break;
        }
        if (L > Math.max(p, q) + THIN_FEATURE_STEP) {
          light++;
          break;
        }
      }
    }
  }
  // The small prior keeps a picture with hardly any thin features at 0.5 (= no evidence).
  const prior = Math.max(1, measured) * 0.002;
  return (dark + prior) / (dark + light + 2 * prior) > INK_ASYMMETRY;
}

// ---------------------------------------------------------------------------------------------
// Silhouette

export interface Silhouette {
  /** 1 = antialiasing fringe: a subject pixel at the edge that is a blend of paper and the pixel behind it. */
  fringe: Uint8Array;
  /** 1 = within 3 pixels of the background. */
  band: Uint8Array;
}

/** Fringe pixels reach this many pixels into the subject… */
const FRINGE_DEPTH = 2;
/** …and the pixel behind is at least this much (CIE76) further from the paper colour. */
const FRINGE_STEP = 8;
const BAND_DEPTH = 3;

const silhouetteCache = new WeakMap<Uint8Array, Silhouette>();

export function silhouette(d: Derived, mask: Uint8Array, bgHex: string): Silhouette {
  const hit = silhouetteCache.get(mask);
  if (hit) return hit;
  const { w, h, n } = d;
  const { lab } = drawingPixels(d);
  const [bl, ba, bb] = hexToLab(bgHex);
  const fromPaper = (i: number) => Math.hypot(lab[i * 3] - bl, lab[i * 3 + 1] - ba, lab[i * 3 + 2] - bb);
  const depth = stepsTo(mask, w, h, BAND_DEPTH + 1);
  const fringe = new Uint8Array(n);
  const band = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    if (mask[i] || depth[i] > BAND_DEPTH) continue;
    band[i] = 1;
    if (depth[i] > FRINGE_DEPTH) continue;
    const x = i % w;
    const y = (i / w) | 0;
    const own = fromPaper(i);
    for (let k = 0; k < 4; k++) {
      const dx = k === 0 ? 1 : k === 1 ? -1 : 0;
      const dy = k === 2 ? 1 : k === 3 ? -1 : 0;
      const ix = x + dx, iy = y + dy;
      if (ix < 0 || iy < 0 || ix >= w || iy >= h || mask[iy * w + ix]) continue;
      let outside = false;
      for (let s = 1; s <= FRINGE_DEPTH && !outside; s++) {
        const ox = x - dx * s, oy = y - dy * s;
        outside = ox >= 0 && oy >= 0 && ox < w && oy < h && mask[oy * w + ox] === 1;
      }
      if (outside && fromPaper(iy * w + ix) > own + FRINGE_STEP) {
        fringe[i] = 1;
        break;
      }
    }
  }
  const result = { fringe, band };
  silhouetteCache.set(mask, result);
  return result;
}
