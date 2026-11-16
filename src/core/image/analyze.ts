// OWNER: image-core agent. Working copy, per-image caches, background estimate and subject mask.
import { SRGB_TO_LINEAR, labToHex, linearToLab, hexToLab } from './color';
import { WORKING_SIZE } from './types';
import type { ImageAnalysis, RgbaImage } from './types';

/** Default background tolerance (keep in sync with DEFAULT_PARAMS.backgroundTolerance). */
export const DEFAULT_TOLERANCE = 30;
/** Pixels with alpha below this are transparent = always background. */
export const ALPHA_OPAQUE = 128;
/** Share of the border that must match one colour for it to count as the background. */
const BORDER_SHARE = 0.6;
/** CIE76 radius of the border colour cluster. */
const BORDER_RADIUS = 14;
/** Subjects smaller than this share of the image are ignored (no usable background/subject split). */
const MIN_SUBJECT_SHARE = 0.02;
/** Background rejected as textured when more than this share of it was reached only by following drift… */
const MAX_DRIFT_SHARE = 0.08;
/** …and the largest subject piece holds less than this share of the subject. */
const MIN_MAIN_COMPONENT = 0.7;
/** An enclosed background-coloured region is a see-through hole when it covers this share of the subject box. */
export const HOLE_SHARE = 0.02;

// ---------------------------------------------------------------------------------------------
// Downscaling (area average, premultiplied alpha)

interface Tap {
  start: number;
  weights: number[];
}

function taps(src: number, dst: number): Tap[] {
  const scale = src / dst;
  const out: Tap[] = [];
  for (let i = 0; i < dst; i++) {
    const a = i * scale;
    const b = Math.min(src, (i + 1) * scale);
    const start = Math.floor(a);
    const weights: number[] = [];
    for (let s = start; s < b; s++) {
      const w = Math.min(b, s + 1) - Math.max(a, s);
      if (w > 1e-9) weights.push(w);
    }
    let sum = 0;
    for (const w of weights) sum += w;
    out.push({ start, weights: weights.map((w) => w / sum) });
  }
  return out;
}

/** Box-filter (area-average) downscale so the long side is ≤ maxSide. Always returns a fresh copy. */
export function downscale(image: RgbaImage, maxSide = WORKING_SIZE): RgbaImage {
  const { width: w, height: h, data } = image;
  const long = Math.max(w, h);
  if (long <= maxSide) return { width: w, height: h, data: new Uint8ClampedArray(data) };
  const s = long / maxSide;
  const dw = Math.max(1, Math.round(w / s));
  const dh = Math.max(1, Math.round(h / s));
  const tx = taps(w, dw);
  const ty = taps(h, dh);
  // Horizontal pass into premultiplied floats (dw × h).
  const tmp = new Float32Array(dw * h * 4);
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < dw; x++) {
      const { start, weights } = tx[x];
      let r = 0, g = 0, b = 0, a = 0;
      for (let k = 0; k < weights.length; k++) {
        const p = (row + start + k) * 4;
        const wa = weights[k] * data[p + 3];
        r += data[p] * wa;
        g += data[p + 1] * wa;
        b += data[p + 2] * wa;
        a += wa;
      }
      const o = (y * dw + x) * 4;
      tmp[o] = r;
      tmp[o + 1] = g;
      tmp[o + 2] = b;
      tmp[o + 3] = a;
    }
  }
  const out = new Uint8ClampedArray(dw * dh * 4);
  for (let y = 0; y < dh; y++) {
    const { start, weights } = ty[y];
    for (let x = 0; x < dw; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let k = 0; k < weights.length; k++) {
        const p = ((start + k) * dw + x) * 4;
        const wk = weights[k];
        r += tmp[p] * wk;
        g += tmp[p + 1] * wk;
        b += tmp[p + 2] * wk;
        a += tmp[p + 3] * wk;
      }
      const o = (y * dw + x) * 4;
      if (a > 0) {
        out[o] = r / a;
        out[o + 1] = g / a;
        out[o + 2] = b / a;
      }
      out[o + 3] = a;
    }
  }
  return { width: dw, height: dh, data: out };
}

// ---------------------------------------------------------------------------------------------
// Per-image derived data (cached by image object; results are identical with or without the cache)

export interface Derived {
  w: number;
  h: number;
  n: number;
  /** 1 = opaque (alpha ≥ ALPHA_OPAQUE). */
  opaque: Uint8Array;
  /** Colour composited over white, sRGB bytes (3 per pixel). */
  rgb: Uint8Array;
  /** Linear RGB (3 per pixel) of the composited colour. */
  lin: Float32Array;
  /** Lab of a 3×3 box blur of the composited colour (noise-robust; used for masks). */
  blurLab: Float32Array;
  /** Coarse colour bin per pixel: 4 bits per channel (r<<8 | g<<4 | b). */
  bin: Uint16Array;
  /** The image border is mostly transparent: transparency alone defines the background. */
  transparentBg: boolean;
  dist: Map<string, Float32Array>;
  masks: Map<string, Uint8Array>;
}

const derivedCache = new WeakMap<RgbaImage, Derived>();

export function derive(image: RgbaImage): Derived {
  const hit = derivedCache.get(image);
  if (hit) return hit;
  const { width: w, height: h, data } = image;
  const n = w * h;
  const opaque = new Uint8Array(n);
  const rgb = new Uint8Array(n * 3);
  const lin = new Float32Array(n * 3);
  const lab = new Float32Array(n * 3);
  const bin = new Uint16Array(n);
  for (let i = 0; i < n; i++) {
    const p = i * 4;
    const a = data[p + 3];
    opaque[i] = a >= ALPHA_OPAQUE ? 1 : 0;
    const f = a / 255;
    const r = Math.round(data[p] * f + 255 * (1 - f));
    const g = Math.round(data[p + 1] * f + 255 * (1 - f));
    const b = Math.round(data[p + 2] * f + 255 * (1 - f));
    rgb[i * 3] = r;
    rgb[i * 3 + 1] = g;
    rgb[i * 3 + 2] = b;
    lin[i * 3] = SRGB_TO_LINEAR[r];
    lin[i * 3 + 1] = SRGB_TO_LINEAR[g];
    lin[i * 3 + 2] = SRGB_TO_LINEAR[b];
    linearToLab(lin[i * 3], lin[i * 3 + 1], lin[i * 3 + 2], lab, i * 3);
    bin[i] = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
  }
  const blurLab = boxBlur3(lab, w, h);
  let ring = 0;
  let clear = 0;
  forEachBorder(w, h, borderThickness(w, h), (i) => {
    ring++;
    if (!opaque[i]) clear++;
  });
  const d: Derived = {
    w, h, n, opaque, rgb, lin, blurLab, bin,
    transparentBg: ring > 0 && clear >= ring * BORDER_SHARE,
    dist: new Map(),
    masks: new Map(),
  };
  derivedCache.set(image, d);
  return d;
}

function boxBlur3(src: Float32Array, w: number, h: number): Float32Array {
  const tmp = new Float32Array(src.length);
  const out = new Float32Array(src.length);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const x0 = Math.max(0, x - 1);
      const x1 = Math.min(w - 1, x + 1);
      const o = (y * w + x) * 3;
      for (let c = 0; c < 3; c++) {
        let s = 0;
        for (let xx = x0; xx <= x1; xx++) s += src[(y * w + xx) * 3 + c];
        tmp[o + c] = s / (x1 - x0 + 1);
      }
    }
  }
  for (let y = 0; y < h; y++) {
    const y0 = Math.max(0, y - 1);
    const y1 = Math.min(h - 1, y + 1);
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 3;
      for (let c = 0; c < 3; c++) {
        let s = 0;
        for (let yy = y0; yy <= y1; yy++) s += tmp[(yy * w + x) * 3 + c];
        out[o + c] = s / (y1 - y0 + 1);
      }
    }
  }
  return out;
}

function borderThickness(w: number, h: number): number {
  return Math.max(1, Math.min(Math.round(Math.max(w, h) / 100), Math.floor(Math.min(w, h) / 4) || 1));
}

/** Calls fn for every pixel index in the outer ring of the given thickness (each pixel once). */
function forEachBorder(w: number, h: number, t: number, fn: (i: number) => void): void {
  for (let y = 0; y < h; y++) {
    const edgeRow = y < t || y >= h - t;
    for (let x = 0; x < w; x++) {
      if (edgeRow || x < t || x >= w - t) fn(y * w + x);
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Background colour from the border

/** '#rrggbb' of the dominant border colour, or null when the border is too varied. */
export function estimateBackground(d: Derived): string | null {
  if (d.transparentBg) return '#ffffff';
  const ring: number[] = [];
  forEachBorder(d.w, d.h, borderThickness(d.w, d.h), (i) => {
    if (d.opaque[i]) ring.push(i);
  });
  if (ring.length === 0) return null;
  const L = d.blurLab;
  const r2 = BORDER_RADIUS * BORDER_RADIUS;
  const step = Math.max(1, Math.floor(ring.length / 96));
  let bestCount = -1;
  let best = ring[0];
  for (let c = 0; c < ring.length; c += step) {
    const ci = ring[c] * 3;
    let count = 0;
    for (const i of ring) {
      const p = i * 3;
      const dl = L[p] - L[ci], da = L[p + 1] - L[ci + 1], db = L[p + 2] - L[ci + 2];
      if (dl * dl + da * da + db * db <= r2) count++;
    }
    if (count > bestCount) {
      bestCount = count;
      best = ring[c];
    }
  }
  // Mean of the cluster (twice, to centre it), then the final share.
  let centre = [L[best * 3], L[best * 3 + 1], L[best * 3 + 2]];
  let count = 0;
  for (let iter = 0; iter < 2; iter++) {
    let sl = 0, sa = 0, sb = 0;
    count = 0;
    for (const i of ring) {
      const p = i * 3;
      const dl = L[p] - centre[0], da = L[p + 1] - centre[1], db = L[p + 2] - centre[2];
      if (dl * dl + da * da + db * db <= r2) {
        sl += L[p];
        sa += L[p + 1];
        sb += L[p + 2];
        count++;
      }
    }
    if (count === 0) return null;
    centre = [sl / count, sa / count, sb / count];
  }
  if (count < ring.length * BORDER_SHARE) return null;
  return labToHex(centre[0], centre[1], centre[2]);
}

// ---------------------------------------------------------------------------------------------
// Background mask

function distanceTo(d: Derived, bgHex: string): Float32Array {
  const hit = d.dist.get(bgHex);
  if (hit) return hit;
  const [bl, ba, bb] = hexToLab(bgHex);
  const L = d.blurLab;
  const out = new Float32Array(d.n);
  for (let i = 0; i < d.n; i++) {
    const p = i * 3;
    const dl = L[p] - bl, da = L[p + 1] - ba, db = L[p + 2] - bb;
    out[i] = Math.sqrt(dl * dl + da * da + db * db);
  }
  d.dist.set(bgHex, out);
  return out;
}

/** Tolerance 0..100 → CIE76 radius around the background colour. */
export function toleranceRadius(tolerance: number): number {
  return Math.max(0, Math.min(100, tolerance)) * 0.6;
}

/**
 * 1 = background pixel. Rules:
 * - transparent pixels (alpha < 128) are always background; with a transparent border nothing else is;
 * - otherwise a flood fill from the image border. Seeds are border pixels within the tolerance radius R
 *   of the background colour. Every background pixel carries a slowly adapting local background colour,
 *   and a neighbour joins when it is within R/2 of that local colour (and within 2.5R of the global one);
 *   only pixels within R/4 of it (slow drift) update the local colour.
 *   Slow drifts (vignetting, soft shadows, JPEG noise) are followed; steps (object edges) stop the fill;
 * - enclosed regions are subject, EXCEPT an enclosed region of background colour (within R/2) that covers
 *   at least HOLE_SHARE of the subject's bounding box — a see-through hole such as the middle of a ring.
 *   Smaller enclosed patches (eyes, highlights) stay part of the subject.
 */


/** Local background colour adapts this fast to the pixels it walks over. */
const REF_RATE = 0.06;
/** Hard limit of the walk, in units of R from the global background colour. */
const DRIFT_CAP = 2.5;

export function backgroundMask(d: Derived, bgHex: string, tolerance: number): Uint8Array {
  const key = `${d.transparentBg ? 'alpha' : bgHex}|${Math.round(tolerance * 100)}`;
  const hit = d.masks.get(key);
  if (hit) return hit;
  const { n, opaque } = d;
  const mask = new Uint8Array(n);
  for (let i = 0; i < n; i++) if (!opaque[i]) mask[i] = 1;
  if (!d.transparentBg) {
    const R = toleranceRadius(tolerance);
    if (R > 0) {
      const dist = distanceTo(d, bgHex);
      floodFromBorder(d, dist, R, mask);
      fillHoles(d, dist, R / 2, mask);
    }
  }
  if (d.masks.size >= 8) d.masks.delete(d.masks.keys().next().value as string);
  d.masks.set(key, mask);
  return mask;
}

function floodFromBorder(d: Derived, dist: Float32Array, R: number, mask: Uint8Array): void {
  const { w, h, n } = d;
  const L = d.blurLab;
  const cap = DRIFT_CAP * R;
  const local2 = (R / 2) * (R / 2);
  const learn2 = (R / 4) * (R / 4);
  const ref = new Float32Array(n * 3);
  const queue = new Int32Array(n);
  const seen = new Uint8Array(n);
  let head = 0;
  let tail = 0;
  const seed = (i: number) => {
    if (seen[i] || !(mask[i] || dist[i] <= R)) return;
    seen[i] = 1;
    mask[i] = 1;
    ref[i * 3] = L[i * 3];
    ref[i * 3 + 1] = L[i * 3 + 1];
    ref[i * 3 + 2] = L[i * 3 + 2];
    queue[tail++] = i;
  };
  for (let x = 0; x < w; x++) {
    seed(x);
    seed((h - 1) * w + x);
  }
  for (let y = 0; y < h; y++) {
    seed(y * w);
    seed(y * w + w - 1);
  }
  const visit = (p: number, q: number) => {
    if (seen[q]) return;
    const a = p * 3, b = q * 3;
    const dl = L[b] - ref[a], da = L[b + 1] - ref[a + 1], db = L[b + 2] - ref[a + 2];
    const dd = dl * dl + da * da + db * db;
    if (mask[q] !== 1) {
      if (dd > local2) return;
      if (dist[q] > cap) return;
    }
    seen[q] = 1;
    mask[q] = 1;
    // Only genuine slow drift teaches the local colour; pixels on an edge ramp are accepted but not learnt,
    // otherwise the fill could ratchet along an edge into the subject.
    const rate = dd <= learn2 ? REF_RATE : 0;
    ref[b] = ref[a] + dl * rate;
    ref[b + 1] = ref[a + 1] + da * rate;
    ref[b + 2] = ref[a + 2] + db * rate;
    queue[tail++] = q;
  };
  while (head < tail) {
    const p = queue[head++];
    const x = p % w;
    if (x > 0) visit(p, p - 1);
    if (x < w - 1) visit(p, p + 1);
    if (p >= w) visit(p, p - w);
    if (p < n - w) visit(p, p + w);
  }
}

function fillHoles(d: Derived, dist: Float32Array, R: number, mask: Uint8Array): void {
  const { w, n } = d;
  const box = maskBox(mask, d.w, d.h, 0);
  if (!box) return;
  const minArea = Math.max(4, box.w * box.h * HOLE_SHARE);
  const label = new Uint8Array(n);
  const stack = new Int32Array(n);
  const comp: number[] = [];
  for (let s = 0; s < n; s++) {
    if (mask[s] || label[s] || dist[s] > R) continue;
    comp.length = 0;
    let top = 0;
    stack[top++] = s;
    label[s] = 1;
    while (top > 0) {
      const p = stack[--top];
      comp.push(p);
      const x = p % w;
      for (let k = 0; k < 4; k++) {
        const q = k === 0 ? (x > 0 ? p - 1 : -1) : k === 1 ? (x < w - 1 ? p + 1 : -1) : k === 2 ? p - w : p + w;
        if (q < 0 || q >= n || label[q] || mask[q] || dist[q] > R) continue;
        label[q] = 1;
        stack[top++] = q;
      }
    }
    if (comp.length >= minArea) for (const p of comp) mask[p] = 1;
  }
}

/** Bounding box of the non-background pixels, trimming up to `trim` (share) of them on each side; null if none. */
export function maskBox(
  mask: Uint8Array,
  w: number,
  h: number,
  trim: number,
): { x: number; y: number; w: number; h: number } | null {
  const cols = new Int32Array(w);
  const rows = new Int32Array(h);
  let total = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!mask[y * w + x]) {
        cols[x]++;
        rows[y]++;
        total++;
      }
    }
  }
  if (total === 0) return null;
  const cut = Math.floor(total * trim);
  const range = (arr: Int32Array): [number, number] => {
    let lo = 0;
    let acc = 0;
    while (lo < arr.length - 1 && acc + arr[lo] <= cut) acc += arr[lo++];
    while (lo < arr.length - 1 && arr[lo] === 0) lo++;
    let hi = arr.length - 1;
    acc = 0;
    while (hi > lo && acc + arr[hi] <= cut) acc += arr[hi--];
    while (hi > lo && arr[hi] === 0) hi--;
    return [lo, hi];
  };
  const [x0, x1] = range(cols);
  const [y0, y1] = range(rows);
  return { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

// ---------------------------------------------------------------------------------------------
// Analysis

/** Everything but the grids (see grid.ts). */
export function analyze(input: RgbaImage): Omit<ImageAnalysis, 'grids'> {
  const image = downscale(input, WORKING_SIZE);
  const d = derive(image);
  const full = { x: 0, y: 0, w: d.w, h: d.h };
  let background = estimateBackground(d);
  let subjectBox = full;
  let mask: Uint8Array | null = null;
  if (background) {
    mask = backgroundMask(d, background, DEFAULT_TOLERANCE);
    const stats = maskStats(d, background, DEFAULT_TOLERANCE);
    const box = maskBox(mask, d.w, d.h, 0.002);
    const tiny = stats.bgShare > 1 - MIN_SUBJECT_SHARE;
    // A textured backdrop (the fill had to follow lots of drift) that leaves the "subject" in pieces is
    // not a plain background around one subject (silk, wallpaper, landscape): keep the whole picture.
    const textured = stats.extendedShare > MAX_DRIFT_SHARE && stats.mainComponentShare < MIN_MAIN_COMPONENT;
    if (!box || tiny || textured) {
      background = null;
      mask = null;
    } else {
      subjectBox = box;
    }
  }
  const { kind, suggestedColors } = colourComplexity(d, mask);
  return { image, background, subjectBox, kind, suggestedColors };
}

/**
 * Photo vs graphic and a colour count, from the subject pixels (all pixels without a background):
 * 'graphic' when ≥ 80 % of them fall into the 24 biggest 16-level colour bins AND at most 35 % of them
 * lie on soft shading (a small but non-zero local gradient) — flat colours with sharp edges.
 */
function colourComplexity(d: Derived, mask: Uint8Array | null): { kind: 'graphic' | 'photo'; suggestedColors: number } {
  const fine = new Int32Array(4096);
  const coarse = new Int32Array(512);
  const { w, h } = d;
  const L = d.blurLab;
  let count = 0;
  let soft = 0;
  let measured = 0;
  for (let i = 0; i < d.n; i++) {
    if (!d.opaque[i] || (mask && mask[i])) continue;
    const b = d.bin[i];
    fine[b]++;
    coarse[(((b >> 9) & 7) << 6) | (((b >> 5) & 7) << 3) | ((b >> 1) & 7)]++;
    count++;
    const x = i % w;
    const y = (i / w) | 0;
    if (x < 1 || y < 1 || x >= w - 1 || y >= h - 1) continue;
    const gx = Math.hypot(L[(i + 1) * 3] - L[(i - 1) * 3], L[(i + 1) * 3 + 1] - L[(i - 1) * 3 + 1], L[(i + 1) * 3 + 2] - L[(i - 1) * 3 + 2]);
    const gy = Math.hypot(L[(i + w) * 3] - L[(i - w) * 3], L[(i + w) * 3 + 1] - L[(i - w) * 3 + 1], L[(i + w) * 3 + 2] - L[(i - w) * 3 + 2]);
    const g = gx + gy;
    measured++;
    if (g >= 1.5 && g < 8) soft++;
  }
  if (count === 0) return { kind: 'graphic', suggestedColors: 2 };
  const sorted = Array.from(fine).sort((a, b) => b - a);
  let top = 0;
  for (let i = 0; i < 24; i++) top += sorted[i];
  const kind = top >= count * 0.8 && soft <= measured * 0.35 ? 'graphic' : 'photo';
  // Colours: 8-level bins holding a noticeable share that are not just a shade next to a bigger one
  // (antialiasing, JPEG noise, gentle shading).
  const minShare = kind === 'graphic' ? 0.015 : 0.03;
  const big = Array.from(coarse.keys())
    .filter((c) => coarse[c] >= count * minShare)
    .sort((a, b) => coarse[b] - coarse[a] || a - b);
  const kept: number[] = [];
  for (const c of big) {
    const near = kept.some(
      (k) => Math.abs((k >> 6) - (c >> 6)) <= 1 && Math.abs(((k >> 3) & 7) - ((c >> 3) & 7)) <= 1 && Math.abs((k & 7) - (c & 7)) <= 1,
    );
    if (!near) kept.push(c);
  }
  const significant = kept.length + Math.floor((big.length - kept.length) / 3);
  const suggestedColors =
    kind === 'graphic' ? clamp(significant, 2, 12) : clamp(significant + 2, 5, 10);
  return { kind, suggestedColors };
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

/** Diagnostics of a background mask (used to reject unreliable backgrounds). */
export function maskStats(d: Derived, bgHex: string, tolerance: number): {
  /** Share of all pixels that are background. */
  bgShare: number;
  /** Share of the background pixels further than R from the background colour (reached by following drift). */
  extendedShare: number;
  /** Share of the subject pixels in the largest 4-connected subject piece. */
  mainComponentShare: number;
} {
  const mask = backgroundMask(d, bgHex, tolerance);
  const dist = d.transparentBg ? null : distanceTo(d, bgHex);
  const R = toleranceRadius(tolerance);
  const { w, n } = d;
  let bg = 0;
  let extended = 0;
  for (let i = 0; i < n; i++) {
    if (!mask[i]) continue;
    bg++;
    if (dist && d.opaque[i] && dist[i] > R) extended++;
  }
  const label = new Uint8Array(n);
  const stack = new Int32Array(n);
  let largest = 0;
  for (let s = 0; s < n; s++) {
    if (mask[s] || label[s]) continue;
    let top = 0;
    let size = 0;
    stack[top++] = s;
    label[s] = 1;
    while (top > 0) {
      const p = stack[--top];
      size++;
      const x = p % w;
      const visit = (q: number) => {
        if (!mask[q] && !label[q]) {
          label[q] = 1;
          stack[top++] = q;
        }
      };
      if (x > 0) visit(p - 1);
      if (x < w - 1) visit(p + 1);
      if (p >= w) visit(p - w);
      if (p < n - w) visit(p + w);
    }
    if (size > largest) largest = size;
  }
  const subject = n - bg;
  return {
    bgShare: bg / n,
    extendedShare: bg ? extended / bg : 0,
    mainComponentShare: subject ? largest / subject : 0,
  };
}
