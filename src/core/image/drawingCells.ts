// OWNER: image-core agent. 'drawing' sampling: turns drawn art into cells without losing faces and outlines.
//
// 1. The palette comes from the pixels, not from already mixed cells: fills count fully, stroke cores a lot,
//    antialiasing ramps hardly, the fringe around the subject not at all.
// 2. The grid is nudged by up to ⅓ cell to where cells are purest (eyes fall into cells instead of between them).
// 3. A cell's colour balances a vote of its pixels (strokes and pixels that stand out weigh more) against a
//    detail-preserving mean colour (after Weber et al., "Rapid, Detail-Preserving Image Downscaling", 2016).
// 4. Pale bodies get their drawn outline back, so that they stand out from the blank paper.
// 5. Small high-contrast features (pupils, cheeks, teeth) are guaranteed a cell.
// 6. Lonely cells that hardly differ from a neighbour join it (fewer fiddly squares to colour).
import type { Derived } from './analyze';
import { drawingPixels, silhouette } from './drawing';
import type { DrawingPixels, Silhouette } from './drawing';
import type { Points, Quantized } from './quantize';
import { forEach4 } from './raster';

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface DrawingJob {
  d: Derived;
  /** 1 = background; null when the background is kept. */
  mask: Uint8Array | null;
  bgHex: string | null;
  box: Box;
  cols: number;
  rows: number;
  colors: number;
  /** Speckle clean-up passes (0..3). */
  smoothing: number;
  /** The grid may move a fraction of a cell (not when the whole picture was asked for). */
  mayShift: boolean;
  quantize(points: Points, k: number): Quantized;
  /** Saturation / contrast, in place on flat Lab triples. */
  adjust(lab: Float32Array): void;
}

/** Histogram weight of a fill pixel / a stroke pixel / anything else (antialiasing ramps). */
const FILL_WEIGHT = 1;
const STROKE_WEIGHT = 0.6;
const RAMP_WEIGHT = 0.1;
const FILL_STEP = 10;
const STROKE_DEPTH = 22;
/** Vote: extra weight per SALIENT_STEP of difference from the local mean, and for being a stroke core. */
const SALIENT_STEP = 22;
const INK_BOOST = 1.2;
const FRINGE_VOTE = 0.03;
/** Balance of the detail-preserving colour against the vote, and the price of losing the whole vote. */
const DETAIL_BALANCE = 0.4;
const VOTE_COST = 45;
const MAX_COLOUR_COST = 70;
/** A cell is filled from this share of subject pixels; a thin part (leg, antenna) from THIN_COVER. */
const COVER = 0.5;
const THIN_COVER = 0.3;
/** Grid offsets tried, in cells. */
const SHIFTS = [0, -1 / 3, 1 / 3];
/** A fill this light and this unsaturated vanishes on paper without an outline… */
const PALE_LIGHTNESS = 76;
const PALE_CHROMA = 24;
/** …its outline needs a stroke this much darker in the picture, and a palette colour this much darker. */
const OUTLINE_DROP = 12;
const OUTLINE_CONTRAST = 18;
/** A colour is reserved for the outline when this share of the silhouette is pale… */
const PALE_EDGE_SHARE = 0.3;
/** …and no palette colour is already this close to the stroke's colour. */
const RESERVE_DISTANCE = 12;
/** Features: size in cells, contrast to what surrounds them. */
const FEATURE_MIN_CELLS = 0.3;
const FEATURE_MAX_CELLS = 5;
const FEATURE_CONTRAST = 28;
/** Clean-up: a lonely cell joins a neighbour closer than this (CIE76), per smoothing level. */
const LONELY_CONTRAST = [0, 22, 32, 45];

interface Palette extends Quantized {
  /** Palette index per pixel, −1 = background (or outside the box). */
  label: Int32Array;
}

interface Cells {
  box: Box;
  cols: number;
  rows: number;
  xs: Int32Array;
  ys: Int32Array;
  /** Share of subject pixels per cell. */
  cover: Float32Array;
}

export function drawingCells(job: DrawingJob): { grid: Int32Array; q: Quantized } {
  const { d, mask, bgHex, box, cols, rows } = job;
  const px = drawingPixels(d);
  const cellPx = Math.sqrt((box.w * box.h) / (cols * rows));
  const stroke = px.stroke(Math.max(2, filterRadius(cellPx / 2)));
  const local = px.local(Math.max(1, filterRadius(cellPx * 1.5)));
  const edge = mask && bgHex ? silhouette(d, mask, bgHex) : null;

  const q = choosePalette(job, px, stroke, edge, cellPx);
  if (q.centres.length === 0) return { grid: new Int32Array(cols * rows).fill(-1), q };

  // How much each pixel's vote counts.
  const weight = new Float32Array(d.n);
  const reach = Math.ceil(cellPx);
  const x1 = Math.min(d.w, box.x + box.w + reach);
  const y1 = Math.min(d.h, box.y + box.h + reach);
  for (let y = Math.max(0, box.y - reach); y < y1; y++) {
    for (let x = Math.max(0, box.x - reach); x < x1; x++) {
      const i = y * d.w + x;
      if (q.label[i] < 0) continue;
      if (edge?.fringe[i]) {
        weight[i] = FRINGE_VOTE;
        continue;
      }
      const o = i * 3;
      const dl = px.lab[o] - local[o], da = px.lab[o + 1] - local[o + 1], db = px.lab[o + 2] - local[o + 2];
      const ink = Math.min(1, Math.max(0, stroke[i] - 15) / 25);
      weight[i] = 1 + Math.sqrt(dl * dl + da * da + db * db) / SALIENT_STEP + INK_BOOST * ink;
    }
  }

  const cells = cellLayout(job, mask && job.mayShift ? purestBox(job, q, weight) : box);
  const grid = fillCells(job, px, local, edge, q, weight, cells);
  if (edge) outlinePaleFills(job, px, edge, q, cells, grid);
  if (job.smoothing < 3) stampFeatures(job, q, cells, grid);
  tidy(job, q, cells, grid);
  return { grid, q };
}

/** Filter radii go in steps of about 20 %, so that most moves of the width slider reuse the cached filters. */
function filterRadius(r: number): number {
  return r < 4 ? Math.round(r) : Math.round(1.2 ** Math.round(Math.log(r) / Math.log(1.2)));
}

const centreDistance = (c: ArrayLike<number>, i: number, j: number) =>
  Math.hypot(c[i * 3] - c[j * 3], c[i * 3 + 1] - c[j * 3 + 1], c[i * 3 + 2] - c[j * 3 + 2]);

function nearestCentre(centres: ArrayLike<number>, lab: ArrayLike<number>, o: number): number {
  let best = 0;
  let bestD = Infinity;
  for (let c = 0; c < centres.length; c += 3) {
    const dl = lab[o] - centres[c], da = lab[o + 1] - centres[c + 1], db = lab[o + 2] - centres[c + 2];
    const dd = dl * dl + da * da + db * db;
    if (dd < bestD) {
      bestD = dd;
      best = c / 3;
    }
  }
  return best;
}

const isPale = (l: number, a: number, b: number) => l > PALE_LIGHTNESS && Math.hypot(a, b) < PALE_CHROMA;

// ---------------------------------------------------------------------------------------------
// 1. Palette

function choosePalette(job: DrawingJob, px: DrawingPixels, stroke: Float32Array, edge: Silhouette | null, cellPx: number): Palette {
  const { d, mask, box } = job;
  const { lab, key, step } = px;
  // The box plus a cell all round, as the grid may move a little.
  const reach = Math.ceil(cellPx);
  const x0 = Math.max(0, box.x - reach);
  const y0 = Math.max(0, box.y - reach);
  const x1 = Math.min(d.w, box.x + box.w + reach);
  const y1 = Math.min(d.h, box.y + box.h + reach);

  const binOf = new Int32Array(32768);
  const bin = new Int32Array(d.n).fill(-1);
  const sums: number[] = [];
  const counts: number[] = [];
  const weights: number[] = [];
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const i = y * d.w + x;
      if (mask?.[i]) continue;
      let b = binOf[key[i]] - 1;
      if (b < 0) {
        b = counts.length;
        binOf[key[i]] = b + 1;
        counts.push(0);
        weights.push(0);
        sums.push(0, 0, 0);
      }
      bin[i] = b;
      counts[b]++;
      sums[b * 3] += lab[i * 3];
      sums[b * 3 + 1] += lab[i * 3 + 1];
      sums[b * 3 + 2] += lab[i * 3 + 2];
      if (edge?.fringe[i]) continue;
      weights[b] += step[i] < FILL_STEP ? FILL_WEIGHT : stroke[i] > STROKE_DEPTH ? STROKE_WEIGHT : RAMP_WEIGHT;
    }
  }
  if (counts.length === 0) return { centres: [], labels: new Int32Array(0), label: bin };
  const colour = Float32Array.from(sums, (v, i) => v / counts[(i / 3) | 0]);
  job.adjust(colour);

  // Only bins with weight choose the colours; the others (pure fringe) take the nearest one afterwards.
  let chosen = weights.flatMap((w, b) => (w > 0 ? [b] : []));
  const allFringe = chosen.length === 0;
  if (allFringe) chosen = Array.from(counts.keys());
  const points: Points = {
    lab: new Float64Array(chosen.length * 3),
    weight: Float64Array.from(chosen, (b) => (allFringe ? counts[b] : weights[b])),
    count: chosen.length,
  };
  chosen.forEach((b, p) => points.lab.set(colour.subarray(b * 3, b * 3 + 3), p * 3));

  const outline = edge && job.colors >= 3 ? paleOutlineColour(job, px, edge, stroke) : null;
  let q = job.quantize(points, outline ? job.colors - 1 : job.colors);
  let reserved = false;
  if (outline) {
    const closest = nearestCentre(q.centres, outline, 0) * 3;
    const gap = Math.hypot(q.centres[closest] - outline[0], q.centres[closest + 1] - outline[1], q.centres[closest + 2] - outline[2]);
    // Crayons and other fixed colours can't take an extra one.
    if (gap > RESERVE_DISTANCE && !q.fixed) {
      q = { ...q, centres: [...q.centres, outline[0], outline[1], outline[2]] };
      reserved = true;
    } else {
      q = job.quantize(points, job.colors);
    }
  }

  const colourOf = new Int32Array(counts.length).fill(-1);
  if (!reserved) chosen.forEach((b, p) => (colourOf[b] = q.labels[p]));
  for (let b = 0; b < counts.length; b++) if (colourOf[b] < 0) colourOf[b] = nearestCentre(q.centres, colour, b * 3);
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const i = y * d.w + x;
      if (bin[i] >= 0) bin[i] = colourOf[bin[i]];
    }
  }
  return { ...q, label: bin };
}

/** The colour of the stroke round the subject, when much of the subject's edge is too pale to see on paper. */
function paleOutlineColour(job: DrawingJob, px: DrawingPixels, edge: Silhouette, stroke: Float32Array): Float32Array | null {
  const { w, h, n } = job.d;
  const { band } = edge;
  const mask = job.mask!;
  const { lab } = px;
  // The fill just behind the band: up to three rings further in.
  const ring = band.slice();
  let front: number[] = [];
  for (let i = 0; i < n; i++) if (band[i]) front.push(i);
  let behind = 0;
  let pale = 0;
  for (let depth = 0; depth < 3; depth++) {
    const next: number[] = [];
    for (const i of front) {
      forEach4(i, w, h, (j) => {
        if (ring[j] || mask[j]) return;
        ring[j] = 1;
        next.push(j);
        behind++;
        if (isPale(lab[j * 3], lab[j * 3 + 1], lab[j * 3 + 2])) pale++;
      });
    }
    front = next;
  }
  if (behind === 0 || pale < behind * PALE_EDGE_SHARE) return null;
  const dark: number[] = [];
  for (let i = 0; i < n; i++) if (band[i] && stroke[i] > OUTLINE_DROP && lab[i * 3] < PALE_LIGHTNESS + 2) dark.push(i);
  if (dark.length < 8) return null;
  // The darker half: the core of the stroke.
  dark.sort((a, b) => lab[a * 3] - lab[b * 3]);
  const take = Math.ceil(dark.length / 2);
  const mean = new Float32Array(3);
  for (let k = 0; k < take; k++) for (let a = 0; a < 3; a++) mean[a] += lab[dark[k] * 3 + a] / take;
  job.adjust(mean);
  return mean;
}

// ---------------------------------------------------------------------------------------------
// 2. Grid position

function edges(start: number, length: number, count: number): Int32Array {
  return Int32Array.from({ length: count + 1 }, (_, i) => start + Math.floor((i * length) / count));
}

/** The box moved by up to ⅓ cell so that as much (weighted) area as possible agrees with its cell's colour. */
function purestBox(job: DrawingJob, q: Palette, weight: Float32Array): Box {
  const { d, box, cols, rows } = job;
  const K = q.centres.length / 3;
  const votes = new Float64Array(K + 1); // 0 = background
  // An estimate from about 8 × 8 samples per cell is plenty.
  const stride = Math.max(1, Math.floor(Math.sqrt((box.w * box.h) / (cols * rows)) / 8));
  let best = box;
  let bestPurity = -1;
  for (const sy of SHIFTS) {
    for (const sx of SHIFTS) {
      const moved = { ...box, x: box.x + Math.round((sx * box.w) / cols), y: box.y + Math.round((sy * box.h) / rows) };
      const xs = edges(moved.x, moved.w, cols);
      const ys = edges(moved.y, moved.h, rows);
      let agree = 0;
      let all = 0;
      for (let gy = 0; gy < rows; gy++) {
        const y0 = Math.max(0, ys[gy]);
        const y1 = Math.min(d.h, ys[gy + 1]);
        for (let gx = 0; gx < cols; gx++) {
          const x0 = Math.max(0, xs[gx]);
          const x1 = Math.min(d.w, xs[gx + 1]);
          votes.fill(0);
          for (let y = y0; y < y1; y += stride) {
            for (let x = x0; x < x1; x += stride) {
              const i = y * d.w + x;
              const l = q.label[i];
              votes[l + 1] += l < 0 ? 1 : weight[i];
            }
          }
          let most = 0;
          for (let v = 0; v <= K; v++) {
            if (votes[v] > most) most = votes[v];
            all += votes[v];
          }
          agree += most;
        }
      }
      if (all > 0 && agree / all > bestPurity + 1e-9) {
        bestPurity = agree / all;
        best = moved;
      }
    }
  }
  return best;
}

/** Pixel range of a cell, clipped to the image; never empty when the picture has fewer pixels than cells. */
function cellRange(d: Derived, cells: Cells, gx: number, gy: number): [number, number, number, number] {
  const { xs, ys } = cells;
  return [
    Math.max(0, xs[gx]),
    Math.max(0, ys[gy]),
    Math.min(d.w, Math.max(xs[gx] + 1, xs[gx + 1])),
    Math.min(d.h, Math.max(ys[gy] + 1, ys[gy + 1])),
  ];
}

function cellLayout(job: DrawingJob, box: Box): Cells {
  const { d, mask, cols, rows } = job;
  const cells: Cells = {
    box,
    cols,
    rows,
    xs: edges(box.x, box.w, cols),
    ys: edges(box.y, box.h, rows),
    cover: new Float32Array(cols * rows),
  };
  for (let c = 0; c < cols * rows; c++) {
    const [x0, y0, x1, y1] = cellRange(d, cells, c % cols, (c / cols) | 0);
    const all = (x1 - x0) * (y1 - y0);
    if (x1 <= x0 || y1 <= y0) continue;
    let on = 0;
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) if (!mask?.[y * d.w + x]) on++;
    cells.cover[c] = on / all;
  }
  return cells;
}

// ---------------------------------------------------------------------------------------------
// 3. Cell colours

/** A part thinner than a cell: the cell is the crest of the coverage, with mostly empty cells on both sides. */
function isThinPart(cells: Cells, c: number): boolean {
  const { cols, rows, cover } = cells;
  const own = cover[c];
  if (own < THIN_COVER) return false;
  const at = (x: number, y: number) => (x < 0 || y < 0 || x >= cols || y >= rows ? 0 : cover[y * cols + x]);
  const x = c % cols;
  const y = (c / cols) | 0;
  const crest = (a: number, b: number) => a < COVER && b < COVER && a <= own && b < own;
  return crest(at(x - 1, y), at(x + 1, y)) || crest(at(x, y - 1), at(x, y + 1));
}

function fillCells(
  job: DrawingJob,
  px: DrawingPixels,
  local: Float32Array,
  edge: Silhouette | null,
  q: Palette,
  weight: Float32Array,
  cells: Cells,
): Int32Array {
  const { d } = job;
  const { cols, rows, cover } = cells;
  const { lab } = px;
  const K = q.centres.length / 3;
  const votes = new Float64Array(K);
  const target = new Float32Array(3);
  // Fixed colours (crayons) can be far from the picture's, so only the vote counts for them.
  const detail = q.fixed ? 0 : DETAIL_BALANCE;
  const grid = new Int32Array(cols * rows).fill(-1);
  for (let c = 0; c < grid.length; c++) {
    if (cover[c] <= 0 || (cover[c] < COVER && !isThinPart(cells, c))) continue;
    const [x0, y0, x1, y1] = cellRange(d, cells, c % cols, (c / cols) | 0);
    votes.fill(0);
    target.fill(0);
    let total = 0;
    let detailTotal = 0;
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        const i = y * d.w + x;
        const l = q.label[i];
        if (l < 0) continue;
        votes[l] += weight[i];
        total += weight[i];
        if (edge?.fringe[i]) continue;
        const o = i * 3;
        const dl = lab[o] - local[o], da = lab[o + 1] - local[o + 1], db = lab[o + 2] - local[o + 2];
        const w = Math.sqrt(dl * dl + da * da + db * db) + 1;
        target[0] += lab[o] * w;
        target[1] += lab[o + 1] * w;
        target[2] += lab[o + 2] * w;
        detailTotal += w;
      }
    }
    if (total === 0 || detailTotal === 0) continue; // nothing but fringe: a halo cell
    for (let a = 0; a < 3; a++) target[a] /= detailTotal;
    job.adjust(target);
    let best = 0;
    let bestCost = Infinity;
    for (let k = 0; k < K; k++) {
      const o = k * 3;
      const dl = target[0] - q.centres[o], da = target[1] - q.centres[o + 1], db = target[2] - q.centres[o + 2];
      const colourCost = Math.min(MAX_COLOUR_COST, Math.sqrt(dl * dl + da * da + db * db));
      const cost = (1 - detail) * VOTE_COST * (1 - votes[k] / total) + detail * colourCost;
      if (cost < bestCost) {
        bestCost = cost;
        best = k;
      }
    }
    grid[c] = best;
  }
  return grid;
}

// ---------------------------------------------------------------------------------------------
// 4. Outline round pale fills

function outlinePaleFills(job: DrawingJob, px: DrawingPixels, edge: Silhouette, q: Palette, cells: Cells, grid: Int32Array): void {
  const { d } = job;
  const { cols, rows } = cells;
  const { lab } = px;
  const { centres } = q;
  const before = grid.slice();
  const stroke = new Float32Array(3);
  for (let c = 0; c < grid.length; c++) {
    const fill = before[c];
    if (fill < 0) continue;
    const f = fill * 3;
    if (!isPale(centres[f], centres[f + 1], centres[f + 2])) continue;
    const gx = c % cols;
    const gy = (c / cols) | 0;
    const open =
      gx === 0 || gy === 0 || gx === cols - 1 || gy === rows - 1 ||
      before[c - 1] < 0 || before[c + 1] < 0 || before[c - cols] < 0 || before[c + cols] < 0;
    if (!open) continue;
    // The stroke may lie just outside the cell: look one cell around, along the silhouette only.
    const found: number[] = [];
    for (let ny = Math.max(0, gy - 1); ny <= Math.min(rows - 1, gy + 1); ny++) {
      for (let nx = Math.max(0, gx - 1); nx <= Math.min(cols - 1, gx + 1); nx++) {
        const [x0, y0, x1, y1] = cellRange(d, cells, nx, ny);
        for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) if (edge.band[y * d.w + x]) found.push(y * d.w + x);
      }
    }
    if (found.length === 0) continue;
    found.sort((a, b) => lab[a * 3] - lab[b * 3]);
    const take = Math.ceil(found.length / 8);
    stroke.fill(0);
    for (let k = 0; k < take; k++) for (let a = 0; a < 3; a++) stroke[a] += lab[found[k] * 3 + a] / take;
    job.adjust(stroke);
    if (centres[f] - stroke[0] < OUTLINE_DROP) continue;
    let best = -1;
    let bestD = Infinity;
    for (let o = 0; o < centres.length; o += 3) {
      if (centres[o] > centres[f] - OUTLINE_CONTRAST) continue;
      const dd = Math.hypot(stroke[0] - centres[o], stroke[1] - centres[o + 1], stroke[2] - centres[o + 2]);
      if (dd < bestD) {
        bestD = dd;
        best = o / 3;
      }
    }
    if (best >= 0) grid[c] = best;
  }
}

// ---------------------------------------------------------------------------------------------
// 5. Features

function stampFeatures(job: DrawingJob, q: Palette, cells: Cells, grid: Int32Array): void {
  const { d } = job;
  const { box, cols, rows, xs, ys } = cells;
  const { w, h } = d;
  const { label, centres } = q;
  const x0 = Math.max(0, box.x), y0 = Math.max(0, box.y);
  const x1 = Math.min(w, box.x + box.w), y1 = Math.min(h, box.y + box.h);
  if (x1 <= x0 || y1 <= y0) return;
  const colAt = new Int32Array(w).fill(-1);
  const rowAt = new Int32Array(h).fill(-1);
  for (let g = 0; g < cols; g++) for (let x = Math.max(0, xs[g]); x < Math.min(w, xs[g + 1]); x++) colAt[x] = g;
  for (let g = 0; g < rows; g++) for (let y = Math.max(0, ys[g]); y < Math.min(h, ys[g + 1]); y++) rowAt[y] = g;

  const cellArea = (box.w * box.h) / (cols * rows);
  const K = centres.length / 3;
  const around = new Int32Array(K + 1);
  const seen = new Uint8Array(d.n);
  const queue = new Int32Array(d.n);
  const features: { colour: number; score: number; want: number; cells: [number, number][] }[] = [];
  for (let sy = y0; sy < y1; sy++) {
    for (let sx = x0; sx < x1; sx++) {
      const s = sy * w + sx;
      const own = label[s];
      if (seen[s] || own < 0) continue;
      seen[s] = 1;
      queue[0] = s;
      let tail = 1;
      let border = 0;
      let left = sx, right = sx, top = sy, bottom = sy;
      around.fill(0);
      const visit = (j: number) => {
        if (label[j] !== own) {
          around[label[j] + 1]++;
          border++;
        } else if (!seen[j]) {
          seen[j] = 1;
          queue[tail++] = j;
        }
      };
      for (let head = 0; head < tail; head++) {
        const p = queue[head];
        const x = p % w;
        const y = (p / w) | 0;
        if (x < left) left = x;
        if (x > right) right = x;
        if (y < top) top = y;
        if (y > bottom) bottom = y;
        // forEach4 by hand: this is the hottest loop.
        if (x > 0) visit(p - 1);
        if (x < w - 1) visit(p + 1);
        if (y > 0) visit(p - w);
        if (y < h - 1) visit(p + w);
      }
      const area = tail / cellArea;
      // Not on the silhouette, and compact: long thin pieces are strokes, which the vote handles.
      if (area < FEATURE_MIN_CELLS || area > FEATURE_MAX_CELLS || border === 0 || around[0] > border * 0.3) continue;
      const bw = right - left + 1;
      const bh = bottom - top + 1;
      if (tail < bw * bh * 0.4 || Math.max(bw, bh) > 3.5 * Math.min(bw, bh)) continue;
      let contrast = 0;
      for (let k = 0; k < K; k++) if (around[k + 1]) contrast += (around[k + 1] / border) * centreDistance(centres, own, k);
      if (contrast < FEATURE_CONTRAST) continue;
      const per = new Map<number, number>();
      for (let k = 0; k < tail; k++) {
        const gx = colAt[queue[k] % w];
        const gy = rowAt[(queue[k] / w) | 0];
        if (gx < 0 || gy < 0) continue;
        const c = gy * cols + gx;
        per.set(c, (per.get(c) ?? 0) + 1);
      }
      features.push({
        colour: own,
        score: contrast * Math.sqrt(area),
        want: Math.max(1, Math.round(area)),
        cells: [...per].sort((a, b) => b[1] - a[1] || a[0] - b[0]),
      });
    }
  }
  // The strongest feature picks first: a pupil wins over the glint inside it.
  features.sort((a, b) => b.score - a.score);
  const taken = new Uint8Array(grid.length);
  for (const feature of features) {
    let left = feature.want;
    for (const [c] of feature.cells) {
      if (left === 0) break;
      if (taken[c]) continue;
      grid[c] = feature.colour;
      taken[c] = 1;
      left--;
    }
  }
}

// ---------------------------------------------------------------------------------------------
// 6. Clean-up

function tidy(job: DrawingJob, q: Palette, cells: Cells, grid: Int32Array): void {
  const { cols, rows, cover } = cells;
  const limit = LONELY_CONTRAST[job.smoothing];
  for (let pass = 0; pass < job.smoothing; pass++) {
    const before = grid.slice();
    let changed = false;
    for (let c = 0; c < grid.length; c++) {
      const own = before[c];
      const x = c % cols;
      const y = (c / cols) | 0;
      let same = false;
      let filled = 0;
      let closest = -1;
      let closestD = Infinity;
      for (let ny = Math.max(0, y - 1); ny <= Math.min(rows - 1, y + 1); ny++) {
        for (let nx = Math.max(0, x - 1); nx <= Math.min(cols - 1, x + 1); nx++) {
          const n = ny * cols + nx;
          if (n === c) continue;
          const other = before[n];
          if (other < 0) continue;
          filled++;
          if (other === own) same = true;
          if (own < 0) {
            closest = other;
          } else {
            const dd = centreDistance(q.centres, own, other);
            if (dd < closestD) {
              closestD = dd;
              closest = other;
            }
          }
        }
      }
      let next = own;
      if (own < 0) {
        // A pinhole that is partly subject.
        if (filled === 8 && cover[c] >= THIN_COVER) next = closest;
      } else if (filled === 0) {
        // A crumb on the paper.
        if (cover[c] < 0.65 || job.smoothing >= 2) next = -1;
      } else if (!same && closestD < limit) {
        next = closest;
      }
      if (next !== own) {
        grid[c] = next;
        changed = true;
      }
    }
    if (!changed) break;
  }
}
