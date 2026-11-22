// OWNER: image-core agent. Working image → grid of palette indices (crop, sample, quantise, clean up, name).
import { isPaperColor } from '../colors';
import { GRID_MAX, GRID_MIN, MAX_PALETTE } from '../types';
import { backgroundMask, derive } from './analyze';
import type { Derived } from './analyze';
import { hexToLab, labToHex, labToRgbBytes, linearToLab, rgbBytesToLab } from './color';
import { drawingMask, hasEvenPaper } from './drawing';
import { drawingCells } from './drawingCells';
import { uniqueColorNames } from './naming';
import { crayon, fills, kmeans, medianCut, posterize } from './quantize';
import type { Points, Quantized } from './quantize';
import { CELL_SAMPLINGS, COLOR_ALGORITHMS, PARAM_LIMITS } from './types';
import type { ColorAlgorithm, Conversion, ConvertParams, CropMode, DetectedGrid, ImageAnalysis } from './types';

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Margin around the subject, as a share of its longer side. */
const SUBJECT_MARGIN = 0.06;
/** Margin around a drawing, in cells: every square counts for detail. */
const DRAWING_MARGIN_CELLS = 0.5;
/** Palette colours closer than this (CIE76) look the same and are merged (not for crayon colours). */
const MERGE_DISTANCE = 5;
/** A lonely cell this different (CIE76) from a uniform surrounding is a feature (an eye), not noise. */
const FEATURE_CONTRAST = 40;
/** Lightness of a near-white subject colour when the (white) background is removed, so it stays visible. */
const MAX_SUBJECT_LIGHTNESS = 92;
const WHITE_LAB: [number, number, number] = [100, 0, 0];
/** A cell belongs to the subject when at least this share of its pixels does (thin rays, legs survive). */
const SUBJECT_CELL_SHARE = 0.35;
/** Dominant sampling: a darker second colour (outline, eye) wins the cell from this share of its pixels… */
const DARK_FEATURE_SHARE = 0.3;
/** …when it differs at least this much (CIE76) from the main colour and is this much darker (L*). */
const DARK_FEATURE_CONTRAST = 30;
const DARK_FEATURE_DARKER = 15;

const binLab = (bin: number) => rgbBytesToLab(((bin >> 8) << 4) + 8, (((bin >> 4) & 15) << 4) + 8, ((bin & 15) << 4) + 8);

/**
 * The cell's colour bin for dominant sampling: the mode `best`, unless a clearly darker, high-contrast
 * colour covers ≥ DARK_FEATURE_SHARE of the cell — thin dark outlines and small dark features (eyes,
 * mouths) are what make a small pixel picture recognisable, so they win such cells.
 */
function darkFeature(best: number, touched: number[], near: Int32Array, total: number): number {
  const br = best >> 8, bg = (best >> 4) & 15, bb = best & 15;
  let second = -1;
  let secondScore = 0;
  for (const bin of touched) {
    // Only modes clearly apart from the main one (their neighbourhoods do not overlap).
    if (Math.abs((bin >> 8) - br) <= 2 && Math.abs(((bin >> 4) & 15) - bg) <= 2 && Math.abs((bin & 15) - bb) <= 2) continue;
    if (near[bin] > secondScore || (near[bin] === secondScore && bin < second)) {
      secondScore = near[bin];
      second = bin;
    }
  }
  if (second < 0 || secondScore < total * DARK_FEATURE_SHARE) return best;
  const a = binLab(best);
  const b = binLab(second);
  const contrast = Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
  return contrast >= DARK_FEATURE_CONTRAST && b[0] <= a[0] - DARK_FEATURE_DARKER ? second : best;
}

function clampInt(v: number, lo: number, hi: number, fallback: number): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) return fallback;
  return Math.min(hi, Math.max(lo, Math.round(v)));
}

function clampNum(v: number, lo: number, hi: number, fallback: number): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) return fallback;
  return Math.min(hi, Math.max(lo, v));
}

export function sanitizeParams(p: ConvertParams): ConvertParams {
  const L = PARAM_LIMITS;
  return {
    source: p.source === 'grid' ? 'grid' : 'pixelate',
    gridIndex: clampInt(p.gridIndex, 0, 1000, 0),
    width: clampInt(p.width, GRID_MIN, GRID_MAX, 20),
    colors: clampInt(p.colors, L.colors.min, Math.min(L.colors.max, MAX_PALETTE - 1), 6),
    algorithm: COLOR_ALGORITHMS.includes(p.algorithm) ? p.algorithm : 'kmeans',
    sampling: CELL_SAMPLINGS.includes(p.sampling) ? p.sampling : 'dominant',
    removeBackground: p.removeBackground === true,
    backgroundTolerance: clampNum(p.backgroundTolerance, L.backgroundTolerance.min, L.backgroundTolerance.max, 30),
    crop: (['subject', 'full', 'square'] as const).includes(p.crop) ? p.crop : 'subject',
    smoothing: clampInt(p.smoothing, L.smoothing.min, L.smoothing.max, 1),
    saturation: clampNum(p.saturation, L.saturation.min, L.saturation.max, 0),
    contrast: clampNum(p.contrast, L.contrast.min, L.contrast.max, 0),
  };
}

// ---------------------------------------------------------------------------------------------
// Crop

/** Crop rectangle (working-image pixels) for a crop mode, before fitting the grid's aspect limits. */
export function cropBox(analysis: ImageAnalysis, mode: CropMode, marginShare = SUBJECT_MARGIN): Box {
  const W = analysis.image.width;
  const H = analysis.image.height;
  if (mode === 'full') return { x: 0, y: 0, w: W, h: H };
  const s = analysis.subjectBox;
  const x0 = clampInt(s.x, 0, W - 1, 0);
  const y0 = clampInt(s.y, 0, H - 1, 0);
  const box = { x: x0, y: y0, w: clampInt(s.w, 1, W - x0, W - x0), h: clampInt(s.h, 1, H - y0, H - y0) };
  const m = Math.round(Math.max(box.w, box.h) * marginShare);
  if (mode === 'subject') {
    const x = Math.max(0, box.x - m);
    const y = Math.max(0, box.y - m);
    return { x, y, w: Math.min(W, box.x + box.w + m) - x, h: Math.min(H, box.y + box.h + m) - y };
  }
  const side = Math.min(Math.max(box.w, box.h) + 2 * m, W, H);
  const cx = box.x + box.w / 2;
  const cy = box.y + box.h / 2;
  return {
    x: Math.min(W - side, Math.max(0, Math.round(cx - side / 2))),
    y: Math.min(H - side, Math.max(0, Math.round(cy - side / 2))),
    w: side,
    h: side,
  };
}

/** Widen/heighten the crop (inside the image) so `cols` columns give GRID_MIN..GRID_MAX square-ish rows. */
function fitAspect(box: Box, cols: number, W: number, H: number): Box {
  const out = { ...box };
  const grow = (pos: number, len: number, want: number, limit: number): [number, number] => {
    const target = Math.min(limit, Math.ceil(want));
    if (target <= len) return [pos, len];
    const p = Math.min(limit - target, Math.max(0, Math.round(pos - (target - len) / 2)));
    return [p, target];
  };
  if ((cols * out.h) / out.w > GRID_MAX) [out.x, out.w] = grow(out.x, out.w, (cols * out.h) / GRID_MAX, W);
  if ((cols * out.h) / out.w < GRID_MIN) [out.y, out.h] = grow(out.y, out.h, (GRID_MIN * out.w) / cols, H);
  return out;
}

// ---------------------------------------------------------------------------------------------
// Conversion

export function convert(analysis: ImageAnalysis, rawParams: ConvertParams): Conversion {
  const params = sanitizeParams(rawParams);
  const detected = params.source === 'grid' ? analysis.grids?.[params.gridIndex] : undefined;
  if (detected) return convertGrid(detected, params);
  const d = derive(analysis.image);
  const removing = params.removeBackground && analysis.background !== null;
  const bgHex = removing ? analysis.background : null;
  const drawing = params.sampling === 'drawing';
  // The strict drawing mask needs even paper; a gradient or vignette still needs the drift-following one.
  const maskOf = drawing && bgHex && hasEvenPaper(d, bgHex) ? drawingMask : backgroundMask;
  const mask = bgHex ? maskOf(d, bgHex, params.backgroundTolerance) : null;

  const cols = params.width;
  const margin = drawing ? DRAWING_MARGIN_CELLS / cols : SUBJECT_MARGIN;
  const box = fitAspect(cropBox(analysis, params.crop, margin), cols, d.w, d.h);
  const rows = clampInt((cols * box.h) / box.w, GRID_MIN, GRID_MAX, cols);

  if (drawing) {
    const { grid, q } = drawingCells({
      d,
      mask,
      bgHex,
      box,
      cols,
      rows,
      colors: params.colors,
      smoothing: params.smoothing,
      mayShift: params.crop !== 'full',
      quantize: (points, k) => choosePalette(points, k, params.algorithm, removing),
      adjust: (lab) => {
        if (params.saturation || params.contrast) adjustAndSnap(lab, params.saturation, params.contrast);
      },
    });
    return buildConversion(grid, cols, rows, q, removing);
  }

  const cellLab = sampleCells(d, mask, box, cols, rows, params.sampling === 'average');
  adjustAndSnap(cellLab, params.saturation, params.contrast);

  // Distinct cell colours (weighted points).
  const n = cols * rows;
  const pointOf = new Int32Array(n).fill(-1);
  const keyIndex = new Map<number, number>();
  const labs: number[] = [];
  const weights: number[] = [];
  for (let c = 0; c < n; c++) {
    if (Number.isNaN(cellLab[c * 3])) continue;
    const [r, g, b] = labToRgbBytes(cellLab[c * 3], cellLab[c * 3 + 1], cellLab[c * 3 + 2]);
    const key = (r << 16) | (g << 8) | b;
    let idx = keyIndex.get(key);
    if (idx === undefined) {
      idx = weights.length;
      keyIndex.set(key, idx);
      labs.push(cellLab[c * 3], cellLab[c * 3 + 1], cellLab[c * 3 + 2]);
      weights.push(0);
    }
    weights[idx]++;
    pointOf[c] = idx;
  }
  const pts: Points = { lab: Float64Array.from(labs), weight: Float64Array.from(weights), count: weights.length };

  const q = choosePalette(pts, params.colors, params.algorithm, removing);

  const grid = new Int32Array(n);
  for (let c = 0; c < n; c++) grid[c] = pointOf[c] < 0 ? -1 : q.labels[pointOf[c]];
  const K = q.centres.length / 3;
  const colorLab = (v: number): [number, number, number] =>
    v < 0 ? WHITE_LAB : [q.centres[v * 3], q.centres[v * 3 + 1], q.centres[v * 3 + 2]];
  const smoothed = keepEveryColour(grid, smooth(grid, cols, rows, K, colorLab, params.smoothing), K);

  return buildConversion(smoothed, cols, rows, q, removing);
}

function quantise(pts: Points, k: number, algorithm: ColorAlgorithm, excludeWhite: boolean): Quantized {
  switch (algorithm) {
    case 'fills':
      return fills(pts, k);
    case 'median-cut':
      return medianCut(pts, k);
    case 'crayon':
      return crayon(pts, k, excludeWhite);
    case 'posterize':
      return posterize(pts, k);
    default:
      return kmeans(pts, k, 0x5eed);
  }
}

/** The quantiser's colours, with practically identical ones merged. */
function choosePalette(pts: Points, k: number, algorithm: ColorAlgorithm, excludeWhite: boolean): Quantized {
  const q = quantise(pts, k, algorithm, excludeWhite);
  return q.fixed ? q : mergeClose(q, pts);
}

function sampleCells(d: Derived, mask: Uint8Array | null, box: Box, cols: number, rows: number, average: boolean): Float32Array {
  const xs = new Int32Array(cols + 1);
  const ys = new Int32Array(rows + 1);
  for (let i = 0; i <= cols; i++) xs[i] = box.x + Math.floor((i * box.w) / cols);
  for (let j = 0; j <= rows; j++) ys[j] = box.y + Math.floor((j * box.h) / rows);
  const out = new Float32Array(cols * rows * 3).fill(NaN);
  const binCount = new Int32Array(4096);
  const near = new Int32Array(4096);
  const touched: number[] = [];
  const lin = d.lin;
  const w = d.w;
  for (let gy = 0; gy < rows; gy++) {
    const y0 = ys[gy];
    const y1 = Math.max(y0 + 1, ys[gy + 1]);
    for (let gx = 0; gx < cols; gx++) {
      const x0 = xs[gx];
      const x1 = Math.max(x0 + 1, xs[gx + 1]);
      let total = 0;
      let bg = 0;
      if (mask) {
        for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
          total++;
          bg += mask[y * w + x];
        }
        if (total - bg < total * SUBJECT_CELL_SHARE) continue; // background cell (NaN)
      }
      const o = (gy * cols + gx) * 3;
      let r = 0, g = 0, b = 0, cnt = 0;
      if (average) {
        for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
          const i = y * w + x;
          if (mask && mask[i]) continue;
          r += lin[i * 3];
          g += lin[i * 3 + 1];
          b += lin[i * 3 + 2];
          cnt++;
        }
      } else {
        // Mode of 16-level bins, scored with their 26 neighbours (robust to noise at bin edges).
        touched.length = 0;
        let cnt0 = 0;
        for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
          const i = y * w + x;
          if (mask && mask[i]) continue;
          const bin = d.bin[i];
          cnt0++;
          if (binCount[bin]++ === 0) touched.push(bin);
        }
        let best = -1;
        let bestScore = -1;
        for (const bin of touched) {
          const br = bin >> 8, bgc = (bin >> 4) & 15, bb = bin & 15;
          let score = 0;
          for (let dr = -1; dr <= 1; dr++) {
            const rr = br + dr;
            if (rr < 0 || rr > 15) continue;
            for (let dg = -1; dg <= 1; dg++) {
              const gg = bgc + dg;
              if (gg < 0 || gg > 15) continue;
              for (let db = -1; db <= 1; db++) {
                const b2 = bb + db;
                if (b2 < 0 || b2 > 15) continue;
                score += binCount[(rr << 8) | (gg << 4) | b2];
              }
            }
          }
          near[bin] = score;
          score = score * 2 + binCount[bin]; // own bin breaks ties
          if (score > bestScore || (score === bestScore && bin < best)) {
            bestScore = score;
            best = bin;
          }
        }
        best = darkFeature(best, touched, near, cnt0);
        for (const bin of touched) binCount[bin] = 0;
        const br = best >> 8, bgc = (best >> 4) & 15, bb = best & 15;
        for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
          const i = y * w + x;
          if (mask && mask[i]) continue;
          const bin = d.bin[i];
          if (Math.abs((bin >> 8) - br) > 1 || Math.abs(((bin >> 4) & 15) - bgc) > 1 || Math.abs((bin & 15) - bb) > 1) continue;
          r += lin[i * 3];
          g += lin[i * 3 + 1];
          b += lin[i * 3 + 2];
          cnt++;
        }
      }
      if (cnt > 0) linearToLab(r / cnt, g / cnt, b / cnt, out, o);
    }
  }
  return out;
}

/** Saturation/contrast in Lab, then snap to the nearest sRGB byte colour (in gamut). */
function adjustAndSnap(lab: Float32Array, saturation: number, contrast: number): void {
  const cs = 1 + contrast / 100;
  const ss = 1 + saturation / 100;
  for (let o = 0; o < lab.length; o += 3) {
    if (Number.isNaN(lab[o])) continue;
    const L = 50 + (lab[o] - 50) * cs;
    const [r, g, b] = labToRgbBytes(Math.min(100, Math.max(0, L)), lab[o + 1] * ss, lab[o + 2] * ss);
    const back = rgbBytesToLab(r, g, b);
    lab[o] = back[0];
    lab[o + 1] = back[1];
    lab[o + 2] = back[2];
  }
}

/** Merge palette colours that are practically identical (weighted means). */
function mergeClose(q: Quantized, pts: Points): Quantized {
  const k = q.centres.length / 3;
  const weight = new Float64Array(k);
  for (let i = 0; i < pts.count; i++) weight[q.labels[i]] += pts.weight[i];
  const c = q.centres.slice();
  const target = Array.from({ length: k }, (_, i) => i);
  const alive = new Array<boolean>(k).fill(true);
  for (;;) {
    let bi = -1, bj = -1, bd = MERGE_DISTANCE * MERGE_DISTANCE;
    for (let i = 0; i < k; i++) {
      if (!alive[i]) continue;
      for (let j = i + 1; j < k; j++) {
        if (!alive[j]) continue;
        const dl = c[i * 3] - c[j * 3], da = c[i * 3 + 1] - c[j * 3 + 1], db = c[i * 3 + 2] - c[j * 3 + 2];
        const dd = dl * dl + da * da + db * db;
        if (dd < bd) {
          bd = dd;
          bi = i;
          bj = j;
        }
      }
    }
    if (bi < 0) break;
    const wi = weight[bi], wj = weight[bj];
    for (let a = 0; a < 3; a++) c[bi * 3 + a] = (c[bi * 3 + a] * wi + c[bj * 3 + a] * wj) / (wi + wj);
    weight[bi] = wi + wj;
    alive[bj] = false;
    for (let t = 0; t < k; t++) if (target[t] === bj) target[t] = bi;
  }
  const index = new Int32Array(k).fill(-1);
  const centres: number[] = [];
  for (let i = 0; i < k; i++) {
    if (!alive[i]) continue;
    index[i] = centres.length / 3;
    centres.push(c[i * 3], c[i * 3 + 1], c[i * 3 + 2]);
  }
  return { centres, labels: q.labels.map((l) => index[target[l]]) };
}

/**
 * A detected grid taken 1:1 (cols × rows). With removeBackground the most common colour along the grid's
 * border becomes the blank White background. Colours beyond `colors` (not counting that background) are
 * reduced with the chosen algorithm, weighted by cell counts; 'crayon' always snaps to crayon colours.
 * Crop, sampling, smoothing, tolerance and the colour tweaks do not apply.
 */
function convertGrid(g: DetectedGrid, params: ConvertParams): Conversion {
  const { cols, rows, cells } = g;
  let bgHex: string | null = null;
  if (params.removeBackground) {
    const border = new Map<string, number>();
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        if (x > 0 && y > 0 && x < cols - 1 && y < rows - 1) continue;
        const hex = cells[y * cols + x];
        border.set(hex, (border.get(hex) ?? 0) + 1);
      }
    }
    let best = 0;
    for (const [hex, n] of [...border].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
      if (n > best) {
        best = n;
        bgHex = hex;
      }
    }
  }
  const index = new Map<string, number>();
  const exact: string[] = [];
  const weights: number[] = [];
  const pointOf = cells.map((hex) => {
    if (hex === bgHex) return -1;
    let i = index.get(hex);
    if (i === undefined) {
      i = exact.length;
      index.set(hex, i);
      exact.push(hex);
      weights.push(0);
    }
    weights[i]++;
    return i;
  });
  const lab: number[] = [];
  for (const hex of exact) lab.push(...hexToLab(hex));
  const pts: Points = { lab: Float64Array.from(lab), weight: Float64Array.from(weights), count: exact.length };
  let q: Quantized;
  if (params.algorithm === 'crayon') q = crayon(pts, params.colors, bgHex !== null);
  else if (exact.length <= params.colors) q = { centres: lab, labels: Int32Array.from(exact.keys()), exact };
  else q = quantise(pts, params.colors, params.algorithm, bgHex !== null);
  const labels = Int32Array.from(pointOf, (p) => (p < 0 ? -1 : q.labels[p]));
  return buildConversion(labels, cols, rows, q, bgHex !== null);
}

// ---------------------------------------------------------------------------------------------
// Speckle clean-up

const DX = [-1, 0, 1, -1, 1, -1, 0, 1];
const DY = [-1, -1, -1, 0, 0, 1, 1, 1];

/**
 * Majority filter, `passes` times. A cell is replaced by its most common neighbour colour when
 * - no 8-neighbour shares its colour (a lonely cell), or
 * - it is half of an isolated pair (one same-coloured neighbour, which has no other) and ≥ 5 of its
 *   neighbours (all but one at the edge) agree on another colour.
 * Cells in longer runs are never touched, so 1-cell-wide lines (also diagonal ones) survive. A lonely
 * cell/pair inside a uniform surrounding that differs strongly from it (an eye, a highlight) is kept
 * unless smoothing is at its maximum; specks in the removed background, and background pinholes in the
 * subject, are always cleaned.
 */
export function smooth(
  grid: Int32Array,
  W: number,
  H: number,
  K: number,
  colorLab: (v: number) => [number, number, number],
  passes: number,
): Int32Array {
  let cur = grid;
  const counts = new Int32Array(K + 1);
  const same = new Int32Array(W * H);
  const dist = (u: number, v: number) => {
    const a = colorLab(u), b = colorLab(v);
    return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
  };
  const protectFeatures = passes < 3;
  for (let pass = 0; pass < passes; pass++) {
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const v = cur[y * W + x];
      let s = 0;
      for (let k = 0; k < 8; k++) {
        const nx = x + DX[k], ny = y + DY[k];
        if (nx >= 0 && ny >= 0 && nx < W && ny < H && cur[ny * W + nx] === v) s++;
      }
      same[y * W + x] = s;
    }
    const next = cur.slice();
    let changed = 0;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const c = y * W + x;
      const s = same[c];
      if (s >= 2) continue;
      const v = cur[c];
      let nb = 0;
      let partner = -1;
      counts.fill(0);
      for (let k = 0; k < 8; k++) {
        const nx = x + DX[k], ny = y + DY[k];
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        nb++;
        const u = cur[ny * W + nx];
        if (u === v) partner = ny * W + nx;
        else counts[u + 1]++;
      }
      if (nb === 0) continue;
      if (s === 1 && same[partner] !== 1) continue;
      let m = -2;
      let cm = 0;
      for (let u = -1; u < K; u++) {
        const cu = counts[u + 1];
        if (cu === 0) continue;
        if (cu > cm || (cu === cm && dist(u, v) < dist(m, v))) {
          cm = cu;
          m = u;
        }
      }
      if (m === -2) continue;
      if (s === 1 && cm < Math.min(5, nb - 1)) continue;
      if (protectFeatures && v >= 0 && m >= 0 && cm === nb - s && dist(m, v) > FEATURE_CONTRAST) continue;
      next[c] = m;
      changed++;
    }
    cur = next;
    if (changed === 0) break;
  }
  return cur;
}

/** Smoothing must not erase a colour completely: a colour it removed gets all its cells back. */
function keepEveryColour(before: Int32Array, after: Int32Array, K: number): Int32Array {
  const was = new Int32Array(K + 1);
  const now = new Int32Array(K + 1);
  for (let i = 0; i < before.length; i++) {
    was[before[i] + 1]++;
    now[after[i] + 1]++;
  }
  let lost = false;
  for (let v = 0; v <= K; v++) if (was[v] > 0 && now[v] === 0) lost = true;
  if (!lost) return after;
  const out = after.slice();
  for (let i = 0; i < before.length; i++) if (was[before[i] + 1] > 0 && now[before[i] + 1] === 0) out[i] = before[i];
  return out;
}

// ---------------------------------------------------------------------------------------------
// Palette

function buildConversion(grid: Int32Array, W: number, H: number, q: Quantized, removing: boolean): Conversion {
  const K = q.centres.length / 3;
  const usage = new Int32Array(K);
  for (const v of grid) if (v >= 0) usage[v]++;
  const order = Array.from({ length: K }, (_, i) => i)
    .filter((i) => usage[i] > 0)
    .sort((a, b) => usage[b] - usage[a] || a - b);
  // Hex per used colour; identical hexes collapse into one entry.
  const hexes: string[] = [];
  const fixedNames: string[] = [];
  const slot = new Int32Array(K).fill(-1);
  for (const i of order) {
    let hex: string;
    if (q.fixed) {
      hex = q.fixed[i].hex;
    } else {
      let L = q.centres[i * 3];
      const a = q.centres[i * 3 + 1];
      const b = q.centres[i * 3 + 2];
      hex = q.exact ? q.exact[i] : labToHex(L, a, b);
      if (removing && isPaperColor(hex)) {
        L = Math.min(L, MAX_SUBJECT_LIGHTNESS);
        hex = labToHex(L, a, b);
      }
    }
    const existing = hexes.indexOf(hex);
    if (existing >= 0) {
      slot[i] = existing;
      continue;
    }
    slot[i] = hexes.length;
    hexes.push(hex);
    if (q.fixed) fixedNames.push(q.fixed[i].name);
  }
  const names = q.fixed ? fixedNames : uniqueColorNames(hexes, removing ? ['White'] : []);
  const offset = removing ? 1 : 0;
  const palette = [
    ...(removing ? [{ name: 'White', hex: '#ffffff' }] : []),
    ...hexes.map((hex, i) => ({ name: names[i], hex })),
  ];
  const cells = Array.from(grid, (v) => (v < 0 ? 0 : slot[v] + offset));
  if (palette.length === 0) {
    // Defensive: an image without any colour (cannot happen with a non-empty grid).
    palette.push({ name: 'White', hex: '#ffffff' });
  }
  return { width: W, height: H, palette, cells, backgroundRemoved: removing };
}
