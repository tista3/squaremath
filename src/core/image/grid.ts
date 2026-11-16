// OWNER: image-core agent. Finds regular grids of flat-coloured cells (screenshots/scans of pixel or
// colour-by-number pictures) and reads their cell colours.
//
// Pipeline per image (≤ SOURCE_SIZE):
// 1. Line evidence: for vertical lines, a pixel that is darker or lighter than both its horizontal neighbours
//    1–2 px away (thin ridge), or that sits on a colour step; likewise for horizontal lines.
// 2. Long-run filter: grid lines run across many cells while printed text, noise and photo texture make only
//    short runs, so only evidence in long vertical (horizontal) runs is kept (gaps at line crossings allowed).
// 3. Candidate regions: 8-connected components of the kept evidence on a coarse block raster — separates
//    side-by-side panels, title banners and frames.
// 4. Per axis: profile of kept evidence, cell size from the autocorrelation (preferring the fundamental over
//    its multiples), then a least-squares lattice fit of the line peaks (fractional cell size and phase).
//    The grid's extent is the longest run of consecutive lattice lines that are present. A second pass with a
//    run length tied to the cell size drops what is left of the text.
// 5. Cells: the dominant colour of each cell's inset interior (text is a minority), then near-identical
//    colours are merged across cells, so a flat page gives exactly its real colour count.
import { deltaE } from '../colors';
import { GRID_MAX, GRID_MIN } from '../types';
import { downscale } from './analyze';
import { rgbBytesToLab, rgbToHex } from './color';
import { SOURCE_SIZE } from './types';
import type { DetectedGrid, RgbaImage } from './types';

/** Ridge contrast (luminance levels) for line evidence. */
const RIDGE = 12;
/** Colour step (max channel difference across 2 px) for edge evidence. */
const STEP = 40;
/** Gaps (px) bridged inside a run: line crossings, JPEG blocks. */
const RUN_GAP = 3;
/** Minimum run (px) in the first pass. */
const MIN_RUN = 10;
/** Block size of the region raster. */
const BLOCK = 4;
/** Smallest cell (px) that can be detected. */
const MIN_CELL = 5;
/** Cells are this much inset on every side before reading their colour (skips lines and borders). */
const CELL_INSET = 0.22;
/** Cell colours closer than this (CIEDE2000) are the same printed colour. */
const MERGE_DE = 7;
/** Share of lattice lines that must be present on each axis. */
const MIN_COVERAGE = 0.9;
/** Grids below this confidence are not reported. */
export const MIN_GRID_CONFIDENCE = 0.5;

interface Axis {
  /** Line positions (px, fractional) from the first to the last grid line. */
  lines: number[];
  period: number;
  /** Share of lattice lines inside the extent that are present. */
  coverage: number;
  /** RMS residual of the fitted line peaks, relative to the period. */
  residual: number;
}

interface Planes {
  w: number;
  h: number;
  rgb: Uint8Array;
  /** Vertical-line evidence (1 per pixel). */
  ev: Uint8Array;
  /** Horizontal-line evidence. */
  eh: Uint8Array;
}

function planes(img: RgbaImage): Planes {
  const { width: w, height: h, data } = img;
  const n = w * h;
  const rgb = new Uint8Array(n * 3);
  const Y = new Int16Array(n);
  for (let i = 0; i < n; i++) {
    const a = data[i * 4 + 3];
    let r = data[i * 4], g = data[i * 4 + 1], b = data[i * 4 + 2];
    if (a < 255) {
      const f = a / 255;
      r = Math.round(r * f + 255 * (1 - f));
      g = Math.round(g * f + 255 * (1 - f));
      b = Math.round(b * f + 255 * (1 - f));
    }
    rgb[i * 3] = r;
    rgb[i * 3 + 1] = g;
    rgb[i * 3 + 2] = b;
    Y[i] = (77 * r + 150 * g + 29 * b) >> 8;
  }
  const ev = new Uint8Array(n);
  const eh = new Uint8Array(n);
  // Evidence at i for a line across the direction with stride s (1: vertical lines, w: horizontal lines).
  const evidence = (i: number, s: number): boolean => {
    const c = Y[i];
    const a1 = Y[i - s], b1 = Y[i + s];
    const a2 = Y[i - 2 * s], b2 = Y[i + 2 * s];
    // Thin dark or light ridge, 1–3 px wide.
    if ((a1 - c >= RIDGE && b1 - c >= RIDGE) || (c - a1 >= RIDGE && c - b1 >= RIDGE)) return true;
    if ((a2 - c >= RIDGE && b2 - c >= RIDGE) || (c - a2 >= RIDGE && c - b2 >= RIDGE)) return true;
    // Colour step across 2 px.
    const p = (i - s) * 3, q = (i + s) * 3;
    return (
      Math.abs(rgb[p] - rgb[q]) >= STEP || Math.abs(rgb[p + 1] - rgb[q + 1]) >= STEP || Math.abs(rgb[p + 2] - rgb[q + 2]) >= STEP
    );
  };
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 2; x < w - 2; x++) {
      const i = row + x;
      // Flat neighbourhood (the common case): no evidence possible.
      const c = Y[i];
      if (Math.abs(Y[i - 2] - c) < RIDGE && Math.abs(Y[i + 2] - c) < RIDGE && Math.abs(Y[i - 1] - c) < RIDGE &&
          Math.abs(Y[i + 1] - c) < RIDGE && Math.abs(Y[i - 1] - Y[i + 1]) < 4) continue;
      if (evidence(i, 1)) ev[i] = 1;
    }
  }
  for (let y = 2; y < h - 2; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) {
      const i = row + x;
      const c = Y[i];
      if (Math.abs(Y[i - 2 * w] - c) < RIDGE && Math.abs(Y[i + 2 * w] - c) < RIDGE && Math.abs(Y[i - w] - c) < RIDGE &&
          Math.abs(Y[i + w] - c) < RIDGE && Math.abs(Y[i - w] - Y[i + w]) < 4) continue;
      if (evidence(i, w)) eh[i] = 1;
    }
  }
  return { w, h, rgb, ev, eh };
}

/**
 * Kept-evidence counts along one axis inside a box: for 'v', per column the number of pixels that lie in a
 * vertical run of evidence at least `minRun` long; for 'h' the same per row. Optionally marks kept pixels.
 */
function runProfile(
  p: Planes,
  axis: 'v' | 'h',
  box: { x: number; y: number; w: number; h: number },
  minRun: number,
  mark?: Uint8Array,
): Float64Array {
  const ev = axis === 'v' ? p.ev : p.eh;
  const outer = axis === 'v' ? box.w : box.h;
  const inner = axis === 'v' ? box.h : box.w;
  const profile = new Float64Array(outer);
  for (let o = 0; o < outer; o++) {
    let start = -1;
    let last = -1;
    let count = 0;
    const flush = () => {
      if (start >= 0 && last - start + 1 >= minRun) {
        profile[o] += count;
        if (mark) {
          for (let k = start; k <= last; k++) {
            const idx = axis === 'v' ? (box.y + k) * p.w + box.x + o : (box.y + o) * p.w + box.x + k;
            if (ev[idx]) mark[idx] = 1;
          }
        }
      }
    };
    const base = axis === 'v' ? box.y * p.w + box.x + o : (box.y + o) * p.w + box.x;
    const stride = axis === 'v' ? p.w : 1;
    for (let k = 0, idx = base; k < inner; k++, idx += stride) {
      if (!ev[idx]) continue;
      if (start >= 0 && k - last - 1 <= RUN_GAP) {
        last = k;
        count++;
      } else {
        flush();
        start = k;
        last = k;
        count = 1;
      }
    }
    flush();
  }
  return profile;
}

/** Bounding boxes of connected regions of long-run line evidence (block raster, 8-connected). */
function regions(p: Planes): { x: number; y: number; w: number; h: number }[] {
  const full = { x: 0, y: 0, w: p.w, h: p.h };
  const mark = new Uint8Array(p.w * p.h);
  runProfile(p, 'v', full, MIN_RUN, mark);
  runProfile(p, 'h', full, MIN_RUN, mark);
  const bw = Math.ceil(p.w / BLOCK);
  const bh = Math.ceil(p.h / BLOCK);
  const blocks = new Uint8Array(bw * bh);
  for (let y = 0; y < p.h; y++) for (let x = 0; x < p.w; x++) if (mark[y * p.w + x]) blocks[((y / BLOCK) | 0) * bw + ((x / BLOCK) | 0)] = 1;
  const seen = new Uint8Array(bw * bh);
  const stack = new Int32Array(bw * bh);
  const out: { x: number; y: number; w: number; h: number }[] = [];
  for (let s = 0; s < bw * bh; s++) {
    if (!blocks[s] || seen[s]) continue;
    let top = 0;
    stack[top++] = s;
    seen[s] = 1;
    let x0 = bw, y0 = bh, x1 = 0, y1 = 0, size = 0;
    while (top > 0) {
      const b = stack[--top];
      size++;
      const bx = b % bw;
      const by = (b / bw) | 0;
      if (bx < x0) x0 = bx;
      if (bx > x1) x1 = bx;
      if (by < y0) y0 = by;
      if (by > y1) y1 = by;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = bx + dx, ny = by + dy;
          if (nx < 0 || ny < 0 || nx >= bw || ny >= bh) continue;
          const q = ny * bw + nx;
          if (blocks[q] && !seen[q]) {
            seen[q] = 1;
            stack[top++] = q;
          }
        }
      }
    }
    const box = { x: x0 * BLOCK, y: y0 * BLOCK, w: Math.min(p.w, (x1 + 1) * BLOCK) - x0 * BLOCK, h: Math.min(p.h, (y1 + 1) * BLOCK) - y0 * BLOCK };
    if (box.w >= GRID_MIN * MIN_CELL && box.h >= GRID_MIN * MIN_CELL && size >= 8) out.push(box);
  }
  return out;
}

/** Cell size from the autocorrelation of a profile, preferring the fundamental; 0 when nothing periodic. */
function periodOf(profile: Float64Array): number {
  const n = profile.length;
  const maxLag = Math.floor(n / (GRID_MIN - 0.5));
  if (maxLag < MIN_CELL + 1) return 0;
  let mean = 0;
  for (const v of profile) mean += v;
  mean /= n;
  const z = profile.map((v) => v - mean);
  const ac = new Float64Array(maxLag + 2);
  for (let lag = MIN_CELL - 1; lag <= maxLag + 1; lag++) {
    let s = 0;
    for (let i = 0; i + lag < n; i++) s += z[i] * z[i + lag];
    ac[lag] = s / (n - lag);
  }
  let best = 0;
  let bestV = 0;
  for (let lag = MIN_CELL; lag <= maxLag; lag++) {
    if (ac[lag] > ac[lag - 1] && ac[lag] >= ac[lag + 1] && ac[lag] > bestV) {
      bestV = ac[lag];
      best = lag;
    }
  }
  if (best === 0) return 0;
  // A strong local peak at best/m (m = 5..2) means best is a multiple of the real cell size.
  for (let m = 5; m >= 2; m--) {
    const lag = best / m;
    if (lag < MIN_CELL) continue;
    const c = Math.round(lag);
    for (let l = c - 1; l <= c + 1; l++) {
      if (l < MIN_CELL || l > maxLag || Math.abs(l - lag) > 1 + 0.05 * lag) continue;
      if (ac[l] >= ac[l - 1] && ac[l] >= ac[l + 1] && ac[l] >= 0.55 * bestV) return refineLag(ac, l, maxLag);
    }
  }
  return refineLag(ac, best, maxLag);
}

/** Parabolic peak refinement around an integer lag. */
function refineLag(ac: Float64Array, lag: number, maxLag: number): number {
  let l = lag;
  for (let k = Math.max(MIN_CELL, lag - 1); k <= Math.min(maxLag, lag + 1); k++) if (ac[k] > ac[l]) l = k;
  if (l <= MIN_CELL - 1 || l >= maxLag + 1) return l;
  const a = ac[l - 1], b = ac[l], c = ac[l + 1];
  const den = a - 2 * b + c;
  return den < 0 ? l + (0.5 * (a - c)) / den : l;
}

/** Lattice of grid lines along one axis of a box, or null. `support` is the box's other dimension. */
function fitAxis(profile: Float64Array, support: number): Axis | null {
  const n = profile.length;
  const sm = new Float64Array(n);
  for (let i = 0; i < n; i++) sm[i] = (profile[Math.max(0, i - 1)] + 2 * profile[i] + profile[Math.min(n - 1, i + 1)]) / 4;
  let period = periodOf(sm);
  if (period < MIN_CELL) return null;
  // Peaks with a sub-pixel centroid.
  let max = 0;
  for (const v of sm) max = Math.max(max, v);
  if (max <= 0) return null;
  const peaks: { x: number; v: number }[] = [];
  for (let i = 1; i < n - 1; i++) {
    if (sm[i] >= 0.3 * max && sm[i] >= sm[i - 1] && sm[i] > sm[i + 1]) {
      let s = 0, sx = 0;
      for (let k = Math.max(0, i - 2); k <= Math.min(n - 1, i + 2); k++) {
        s += profile[k];
        sx += profile[k] * k;
      }
      peaks.push({ x: s > 0 ? sx / s : i, v: sm[i] });
    }
  }
  if (peaks.length < 3) return null;
  const ref = peaks.reduce((a, b) => (b.v > a.v ? b : a));
  let a = ref.x;
  let b = period;
  let inliers: { x: number; v: number; k: number }[] = [];
  for (let iter = 0; iter < 3; iter++) {
    inliers = [];
    for (const pk of peaks) {
      const k = Math.round((pk.x - a) / b);
      if (Math.abs(pk.x - (a + k * b)) <= 0.22 * b) inliers.push({ ...pk, k });
    }
    // Keep one peak per lattice index (the strongest).
    const byK = new Map<number, { x: number; v: number; k: number }>();
    for (const pk of inliers) if (!byK.has(pk.k) || byK.get(pk.k)!.v < pk.v) byK.set(pk.k, pk);
    inliers = [...byK.values()];
    if (inliers.length < 3) return null;
    let sw = 0, sk = 0, sx = 0, skk = 0, skx = 0;
    for (const pk of inliers) {
      const w = pk.v;
      sw += w;
      sk += w * pk.k;
      sx += w * pk.x;
      skk += w * pk.k * pk.k;
      skx += w * pk.k * pk.x;
    }
    const den = sw * skk - sk * sk;
    if (den <= 0) return null;
    b = (sw * skx - sk * sx) / den;
    a = (sx - b * sk) / sw;
    if (b < MIN_CELL) return null;
  }
  period = b;
  // Line support at every lattice position inside the box.
  const kMin = Math.ceil((-1 - a) / b);
  const kMax = Math.floor((n - a) / b);
  const strength: number[] = [];
  for (let k = kMin; k <= kMax; k++) {
    const c = Math.round(a + k * b);
    let v = 0;
    for (let i = Math.max(0, c - 1); i <= Math.min(n - 1, c + 1); i++) v = Math.max(v, sm[i]);
    strength.push(v / support);
  }
  const inlierStrength = inliers.map((pk) => pk.v / support).sort((x, y) => x - y);
  const typical = inlierStrength[Math.floor(inlierStrength.length / 2)];
  const present = strength.map((s) => s >= 0.4 * typical);
  // Longest run of present lines, bridging single missing lines.
  let bestStart = -1, bestEnd = -1;
  for (let i = 0; i < present.length; i++) {
    if (!present[i]) continue;
    let j = i;
    while (j + 1 < present.length && (present[j + 1] || (j + 2 < present.length && present[j + 2]))) j += present[j + 1] ? 1 : 2;
    if (j - i > bestEnd - bestStart) {
      bestStart = i;
      bestEnd = j;
    }
    i = j;
  }
  if (bestStart < 0) return null;
  const lines: number[] = [];
  let have = 0;
  for (let i = bestStart; i <= bestEnd; i++) {
    lines.push(a + (kMin + i) * b);
    if (present[i]) have++;
  }
  let res = 0;
  for (const pk of inliers) res += (pk.x - (a + pk.k * b)) ** 2;
  return { lines, period, coverage: have / lines.length, residual: Math.sqrt(res / inliers.length) / period };
}

/** Grid lines of a region box (two passes; the second with runs tied to the cell size). */
function fitBox(p: Planes, box: { x: number; y: number; w: number; h: number }): { cols: Axis; rows: Axis } | null {
  let cols = fitAxis(runProfile(p, 'v', box, MIN_RUN), box.h);
  let rows = fitAxis(runProfile(p, 'h', box, MIN_RUN), box.w);
  if (!cols || !rows) return null;
  for (let pass = 0; pass < 2; pass++) {
    const minRun = Math.max(MIN_RUN, Math.round(0.6 * Math.min(cols.period, rows.period)));
    // Restrict each axis to the other's extent (drops banners/text beside the grid).
    const inner = {
      x: Math.max(box.x, Math.floor(box.x + cols.lines[0] - 2)),
      y: Math.max(box.y, Math.floor(box.y + rows.lines[0] - 2)),
      w: 0,
      h: 0,
    };
    inner.w = Math.min(box.x + box.w, Math.ceil(box.x + cols.lines[cols.lines.length - 1] + 3)) - inner.x;
    inner.h = Math.min(box.y + box.h, Math.ceil(box.y + rows.lines[rows.lines.length - 1] + 3)) - inner.y;
    if (inner.w < GRID_MIN * MIN_CELL || inner.h < GRID_MIN * MIN_CELL) return null;
    const c2 = fitAxis(runProfile(p, 'v', { x: box.x, y: inner.y, w: box.w, h: inner.h }, minRun), inner.h);
    const r2 = fitAxis(runProfile(p, 'h', { x: inner.x, y: box.y, w: inner.w, h: box.h }, minRun), inner.w);
    if (!c2 || !r2) return null;
    cols = c2;
    rows = r2;
  }
  return {
    cols: { ...cols, lines: cols.lines.map((v) => v + box.x) },
    rows: { ...rows, lines: rows.lines.map((v) => v + box.y) },
  };
}

const binCounts = new Int32Array(4096);

/** Dominant colour of a cell interior: 16-level bin mode (scored with neighbours), mean of its pixels. */
function cellColour(p: Planes, x0: number, y0: number, x1: number, y1: number): { rgb: [number, number, number]; flat: number } {
  const touched: number[] = [];
  let total = 0;
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
    const i = (y * p.w + x) * 3;
    const bin = ((p.rgb[i] >> 4) << 8) | ((p.rgb[i + 1] >> 4) << 4) | (p.rgb[i + 2] >> 4);
    if (binCounts[bin]++ === 0) touched.push(bin);
    total++;
  }
  let best = 0;
  let bestScore = -1;
  for (const bin of touched) {
    const own = binCounts[bin];
    let score = 0;
    const r0 = bin >> 8, g0 = (bin >> 4) & 15, b0 = bin & 15;
    for (let r = Math.max(0, r0 - 1); r <= Math.min(15, r0 + 1); r++)
      for (let g = Math.max(0, g0 - 1); g <= Math.min(15, g0 + 1); g++)
        for (let b = Math.max(0, b0 - 1); b <= Math.min(15, b0 + 1); b++) score += binCounts[(r << 8) | (g << 4) | b];
    score = score * 2 + own;
    if (score > bestScore || (score === bestScore && bin < best)) {
      bestScore = score;
      best = bin;
    }
  }
  for (const bin of touched) binCounts[bin] = 0;
  const br = best >> 8, bg = (best >> 4) & 15, bb = best & 15;
  let r = 0, g = 0, b = 0, cnt = 0;
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
    const i = (y * p.w + x) * 3;
    if (Math.abs((p.rgb[i] >> 4) - br) > 1 || Math.abs((p.rgb[i + 1] >> 4) - bg) > 1 || Math.abs((p.rgb[i + 2] >> 4) - bb) > 1) continue;
    r += p.rgb[i];
    g += p.rgb[i + 1];
    b += p.rgb[i + 2];
    cnt++;
  }
  return { rgb: [Math.round(r / cnt), Math.round(g / cnt), Math.round(b / cnt)], flat: cnt / total };
}

/** Merge near-identical cell colours (most frequent first, CIEDE2000 against the running cluster means). */
function mergeColours(cells: [number, number, number][]): string[] {
  const keys = new Map<string, { rgb: [number, number, number]; count: number }>();
  for (const c of cells) {
    const k = c.join(',');
    const e = keys.get(k);
    if (e) e.count++;
    else keys.set(k, { rgb: c, count: 1 });
  }
  const uniq = [...keys.values()].sort((a, b) => b.count - a.count || a.rgb.join(',').localeCompare(b.rgb.join(',')));
  interface Cluster {
    sum: [number, number, number];
    count: number;
    lab: [number, number, number];
    members: string[];
  }
  const meanLab = (c: Cluster) => rgbBytesToLab(...(c.sum.map((v) => Math.round(v / c.count)) as [number, number, number]));
  let clusters: Cluster[] = [];
  for (const u of uniq) {
    const lab = rgbBytesToLab(...u.rgb);
    let best: Cluster | null = null;
    let bestD = MERGE_DE;
    for (const c of clusters) {
      const d = deltaE(lab, c.lab);
      if (d <= bestD) {
        bestD = d;
        best = c;
      }
    }
    if (!best) {
      best = { sum: [0, 0, 0], count: 0, lab, members: [] };
      clusters.push(best);
    }
    for (let i = 0; i < 3; i++) best.sum[i] += u.rgb[i] * u.count;
    best.count += u.count;
    best.members.push(u.rgb.join(','));
    best.lab = meanLab(best);
  }
  // Clusters whose means ended up close are one colour too.
  for (let merged = true; merged; ) {
    merged = false;
    outer: for (let i = 0; i < clusters.length; i++) {
      for (let j = i + 1; j < clusters.length; j++) {
        if (deltaE(clusters[i].lab, clusters[j].lab) > MERGE_DE) continue;
        const a = clusters[i], b = clusters[j];
        for (let k = 0; k < 3; k++) a.sum[k] += b.sum[k];
        a.count += b.count;
        a.members.push(...b.members);
        a.lab = meanLab(a);
        clusters = clusters.filter((c) => c !== b);
        merged = true;
        break outer;
      }
    }
  }
  const hexOf = new Map<string, string>();
  for (const c of clusters) {
    const hex = rgbToHex(Math.round(c.sum[0] / c.count), Math.round(c.sum[1] / c.count), Math.round(c.sum[2] / c.count));
    for (const m of c.members) hexOf.set(m, hex);
  }
  return cells.map((c) => hexOf.get(c.join(','))!);
}

function readGrid(p: Planes, cols: Axis, rows: Axis): DetectedGrid | null {
  const nc = cols.lines.length - 1;
  const nr = rows.lines.length - 1;
  if (nc < GRID_MIN || nr < GRID_MIN || nc > GRID_MAX || nr > GRID_MAX) return null;
  const aspect = cols.period / rows.period;
  if (aspect < 0.8 || aspect > 1.25) return null;
  // Real grids draw (nearly) every line; a few shapes that happen to line up leave lattice lines out.
  if (Math.min(cols.coverage, rows.coverage) < MIN_COVERAGE) return null;
  const raw: [number, number, number][] = [];
  let flat = 0;
  for (let r = 0; r < nr; r++) {
    for (let c = 0; c < nc; c++) {
      const xa = cols.lines[c], xb = cols.lines[c + 1];
      const ya = rows.lines[r], yb = rows.lines[r + 1];
      const ix = (xb - xa) * CELL_INSET;
      const iy = (yb - ya) * CELL_INSET;
      const x0 = Math.max(0, Math.round(xa + ix));
      const x1 = Math.min(p.w, Math.max(x0 + 1, Math.round(xb - ix)));
      const y0 = Math.max(0, Math.round(ya + iy));
      const y1 = Math.min(p.h, Math.max(y0 + 1, Math.round(yb - iy)));
      const cell = cellColour(p, x0, y0, x1, y1);
      raw.push(cell.rgb);
      flat += cell.flat;
    }
  }
  flat /= nc * nr;
  const regular = Math.max(0, 1 - 4 * Math.max(cols.residual, rows.residual));
  const confidence = Math.max(0, Math.min(1, cols.coverage * rows.coverage * regular * Math.min(1, flat / 0.85)));
  const x0 = cols.lines[0], y0 = rows.lines[0];
  return {
    box: {
      x: Math.round(x0),
      y: Math.round(y0),
      w: Math.round(cols.lines[nc] - x0),
      h: Math.round(rows.lines[nr] - y0),
    },
    cols: nc,
    rows: nr,
    cells: mergeColours(raw),
    confidence,
  };
}

/**
 * Regular colour grids in `image` (downscaled to SOURCE_SIZE first), largest first. Boxes are in the
 * pixels of the given image.
 */
export function detectGrids(image: RgbaImage): DetectedGrid[] {
  if (image.width < GRID_MIN * MIN_CELL || image.height < GRID_MIN * MIN_CELL) return [];
  const src = Math.max(image.width, image.height) > SOURCE_SIZE ? downscale(image, SOURCE_SIZE) : image;
  const scale = image.width / src.width;
  const p = planes(src);
  const found: DetectedGrid[] = [];
  for (const box of regions(p)) {
    const fit = fitBox(p, box);
    if (!fit) continue;
    const grid = readGrid(p, fit.cols, fit.rows);
    if (grid && grid.confidence >= MIN_GRID_CONFIDENCE) found.push(grid);
  }
  // Overlapping detections: keep the more confident.
  found.sort((a, b) => b.confidence - a.confidence);
  const kept: DetectedGrid[] = [];
  for (const g of found) {
    const overlaps = kept.some((k) => {
      const ix = Math.max(0, Math.min(k.box.x + k.box.w, g.box.x + g.box.w) - Math.max(k.box.x, g.box.x));
      const iy = Math.max(0, Math.min(k.box.y + k.box.h, g.box.y + g.box.h) - Math.max(k.box.y, g.box.y));
      return ix * iy > 0.3 * Math.min(k.box.w * k.box.h, g.box.w * g.box.h);
    });
    if (!overlaps) kept.push(g);
  }
  const ordered = orderGrids(kept);
  if (scale !== 1) {
    for (const g of ordered) {
      g.box = { x: Math.round(g.box.x * scale), y: Math.round(g.box.y * scale), w: Math.round(g.box.w * scale), h: Math.round(g.box.h * scale) };
    }
  }
  return ordered;
}

/**
 * Largest first; grids of about the same size (within 15 % of the area) — panels of one worksheet page —
 * in reading order (rows of panels top to bottom, each row left to right).
 */
function orderGrids(grids: DetectedGrid[]): DetectedGrid[] {
  const area = (g: DetectedGrid) => g.box.w * g.box.h;
  const bySize = [...grids].sort((a, b) => area(b) - area(a) || a.box.y - b.box.y || a.box.x - b.box.x);
  const out: DetectedGrid[] = [];
  for (let i = 0; i < bySize.length; ) {
    let j = i + 1;
    while (j < bySize.length && area(bySize[j]) >= 0.85 * area(bySize[i])) j++;
    const group = bySize.slice(i, j);
    group.sort((a, b) => {
      const sameRow = Math.abs(a.box.y + a.box.h / 2 - (b.box.y + b.box.h / 2)) < Math.min(a.box.h, b.box.h) / 2;
      return sameRow ? a.box.x - b.box.x : a.box.y - b.box.y;
    });
    out.push(...group);
    i = j;
  }
  return out;
}
