// OWNER: image-core agent. Colour quantisers over weighted Lab points (one point per distinct cell colour).
import { deltaE } from '../colors';
import { createRng, mixSeed } from '../rng';
import { TEMPLATE_COLORS } from '../templates/build';
import { hexToLab, labToRgbBytes } from './color';

/** Weighted points in CIELAB: lab has 3 numbers per point. */
export interface Points {
  lab: Float64Array;
  weight: Float64Array;
  count: number;
}

export interface Quantized {
  /** Lab of each colour (3 per colour). */
  centres: number[];
  /** Colour index per point. */
  labels: Int32Array;
  /** Fixed hex/name per colour (crayon algorithm only). */
  fixed?: { hex: string; name: string }[];
  /** Exact hex per colour (grid pictures whose colours need no reduction); names are still chosen. */
  exact?: string[];
}

function d2(lab: ArrayLike<number>, i: number, c: ArrayLike<number>, j: number): number {
  const dl = lab[i * 3] - c[j * 3];
  const da = lab[i * 3 + 1] - c[j * 3 + 1];
  const db = lab[i * 3 + 2] - c[j * 3 + 2];
  return dl * dl + da * da + db * db;
}

function nearest(lab: ArrayLike<number>, i: number, centres: ArrayLike<number>, k: number): number {
  let best = 0;
  let bestD = Infinity;
  for (let c = 0; c < k; c++) {
    const d = d2(lab, i, centres, c);
    if (d < bestD) {
      bestD = d;
      best = c;
    }
  }
  return best;
}

/** Weighted means of the points per label; drops empty colours and relabels. */
function finish(pts: Points, labels: Int32Array, k: number): Quantized {
  const sum = new Float64Array(k * 4);
  for (let i = 0; i < pts.count; i++) {
    const c = labels[i];
    const w = pts.weight[i];
    sum[c * 4] += pts.lab[i * 3] * w;
    sum[c * 4 + 1] += pts.lab[i * 3 + 1] * w;
    sum[c * 4 + 2] += pts.lab[i * 3 + 2] * w;
    sum[c * 4 + 3] += w;
  }
  const remap = new Int32Array(k).fill(-1);
  const centres: number[] = [];
  for (let c = 0; c < k; c++) {
    const w = sum[c * 4 + 3];
    if (w <= 0) continue;
    remap[c] = centres.length / 3;
    centres.push(sum[c * 4] / w, sum[c * 4 + 1] / w, sum[c * 4 + 2] / w);
  }
  const out = new Int32Array(pts.count);
  for (let i = 0; i < pts.count; i++) out[i] = remap[labels[i]];
  return { centres, labels: out };
}

// ---------------------------------------------------------------------------------------------
// k-means (k-means++ seeding, a few deterministic restarts, best SSE wins)

export function kmeans(pts: Points, k: number, seed = 1, attempts = 3, iterations = 40): Quantized {
  const n = pts.count;
  k = Math.min(k, n);
  if (k <= 0) return { centres: [], labels: new Int32Array(0) };
  let best: { labels: Int32Array; sse: number } | null = null;
  for (let attempt = 0; attempt < attempts; attempt++) {
    const rng = createRng(mixSeed(seed, attempt, n, k));
    const centres = new Float64Array(k * 3);
    const dmin = new Float64Array(n).fill(Infinity);
    const probs = new Float64Array(n);
    let total = 0;
    for (let i = 0; i < n; i++) total += pts.weight[i];
    let pick = pickWeighted(pts.weight, total, rng.next());
    let kk = 0;
    for (;;) {
      centres.set(pts.lab.subarray(pick * 3, pick * 3 + 3), kk * 3);
      let sum = 0;
      for (let i = 0; i < n; i++) {
        const d = d2(pts.lab, i, centres, kk);
        if (d < dmin[i]) dmin[i] = d;
        probs[i] = dmin[i] * pts.weight[i];
        sum += probs[i];
      }
      kk++;
      if (kk >= k || sum <= 1e-9) break; // enough centres, or every point already sits on one
      pick = pickWeighted(probs, sum, rng.next());
    }
    const labels = new Int32Array(n);
    for (let iter = 0; iter < iterations; iter++) {
      let changed = 0;
      for (let i = 0; i < n; i++) {
        const c = nearest(pts.lab, i, centres, kk);
        if (c !== labels[i] || iter === 0) {
          if (c !== labels[i]) changed++;
          labels[i] = c;
        }
      }
      if (iter > 0 && changed === 0) break;
      const sum = new Float64Array(kk * 4);
      for (let i = 0; i < n; i++) {
        const c = labels[i];
        const w = pts.weight[i];
        sum[c * 4] += pts.lab[i * 3] * w;
        sum[c * 4 + 1] += pts.lab[i * 3 + 1] * w;
        sum[c * 4 + 2] += pts.lab[i * 3 + 2] * w;
        sum[c * 4 + 3] += w;
      }
      for (let c = 0; c < kk; c++) {
        const w = sum[c * 4 + 3];
        if (w > 0) {
          centres[c * 3] = sum[c * 4] / w;
          centres[c * 3 + 1] = sum[c * 4 + 1] / w;
          centres[c * 3 + 2] = sum[c * 4 + 2] / w;
        }
      }
    }
    let sse = 0;
    for (let i = 0; i < n; i++) sse += d2(pts.lab, i, centres, labels[i]) * pts.weight[i];
    if (!best || sse < best.sse - 1e-9) best = { labels, sse };
  }
  return finish(pts, best!.labels, k);
}

function pickWeighted(weights: ArrayLike<number>, total: number, r: number): number {
  let t = r * total;
  for (let i = 0; i < weights.length; i++) {
    t -= weights[i];
    if (t < 0) return i;
  }
  for (let i = weights.length - 1; i >= 0; i--) if (weights[i] > 0) return i;
  return 0;
}

// ---------------------------------------------------------------------------------------------
// Fills: over-segment, then merge (a palette for drawn art)

/** Colours the merge starts from. */
const FILL_SEEDS = 24;
/** Lab grid on which the points are pooled before seeding (speed only). */
const FILL_POOL = 4;
/** Lightness counts this much when merging, so two shades of one fill merge before two hues do. */
const FILL_LIGHTNESS = 0.8;
/** Softened Ward size term (1 = plain Ward): small but distinct accents keep their colour. */
const FILL_SIZE_POWER = 0.65;
const FILL_REFINE = 3;

export function fills(pts: Points, k: number): Quantized {
  if (pts.count === 0 || k <= 0) return { centres: [], labels: new Int32Array(pts.count) };
  const pool = new Map<number, number[]>();
  for (let i = 0; i < pts.count; i++) {
    const at = (a: number) => Math.floor(pts.lab[i * 3 + a] / FILL_POOL) + 100;
    const key = at(0) * 40000 + at(1) * 200 + at(2);
    let p = pool.get(key);
    if (!p) pool.set(key, (p = [0, 0, 0, 0]));
    for (let a = 0; a < 3; a++) p[a] += pts.lab[i * 3 + a] * pts.weight[i];
    p[3] += pts.weight[i];
  }
  const pooled = [...pool.values()];
  const seeds = kmeans(
    {
      lab: Float64Array.from(pooled.flatMap(([l, a, b, w]) => [l / w, a / w, b / w])),
      weight: Float64Array.from(pooled, (p) => p[3]),
      count: pooled.length,
    },
    FILL_SEEDS,
    0x5eed,
    // Only seeds for the merge: one quick run is as good as several exact ones.
    1,
    8,
  );
  const c = Float64Array.from(seeds.centres);
  const n = c.length / 3;
  const weight = new Float64Array(n);
  pooled.forEach((p, i) => (weight[seeds.labels[i]] += p[3]));
  let total = 0;
  for (const w of weight) total += w;

  const alive = new Array<boolean>(n).fill(true);
  for (let left = n; left > k; left--) {
    let bi = 0, bj = 0, best = Infinity;
    for (let i = 0; i < n; i++) {
      if (!alive[i]) continue;
      for (let j = i + 1; j < n; j++) {
        if (!alive[j]) continue;
        const dl = (c[i * 3] - c[j * 3]) * FILL_LIGHTNESS, da = c[i * 3 + 1] - c[j * 3 + 1], db = c[i * 3 + 2] - c[j * 3 + 2];
        const size = (weight[i] * weight[j]) / (weight[i] + weight[j]) / total;
        const cost = (dl * dl + da * da + db * db) * size ** FILL_SIZE_POWER;
        if (cost < best) {
          best = cost;
          bi = i;
          bj = j;
        }
      }
    }
    const wi = weight[bi], wj = weight[bj];
    for (let a = 0; a < 3; a++) c[bi * 3 + a] = (c[bi * 3 + a] * wi + c[bj * 3 + a] * wj) / (wi + wj);
    weight[bi] = wi + wj;
    alive[bj] = false;
  }

  // A few k-means steps on the real points make the merged colours representative.
  let centres = Array.from(c).filter((_, i) => alive[Math.floor(i / 3)]);
  let result: Quantized = { centres, labels: new Int32Array(pts.count) };
  for (let step = 0; step < FILL_REFINE; step++) {
    const labels = new Int32Array(pts.count);
    for (let i = 0; i < pts.count; i++) labels[i] = nearest(pts.lab, i, centres, centres.length / 3);
    result = finish(pts, labels, centres.length / 3);
    centres = result.centres;
  }
  return result;
}

// ---------------------------------------------------------------------------------------------
// Median cut (Lab boxes; the box with the widest spread, weighted by population, is split at its median)

export function medianCut(pts: Points, k: number): Quantized {
  const n = pts.count;
  if (n === 0) return { centres: [], labels: new Int32Array(0) };
  let boxes: number[][] = [Array.from({ length: n }, (_, i) => i)];
  const spread = (box: number[]) => {
    let best = 0;
    let axis = 0;
    for (let a = 0; a < 3; a++) {
      let lo = Infinity;
      let hi = -Infinity;
      for (const i of box) {
        const v = pts.lab[i * 3 + a];
        if (v < lo) lo = v;
        if (v > hi) hi = v;
      }
      if (hi - lo > best) {
        best = hi - lo;
        axis = a;
      }
    }
    let w = 0;
    for (const i of box) w += pts.weight[i];
    return { range: best, axis, score: best * Math.sqrt(w) };
  };
  while (boxes.length < k) {
    let pick = -1;
    let pickScore = 0;
    let pickAxis = 0;
    boxes.forEach((box, b) => {
      if (box.length < 2) return;
      const s = spread(box);
      if (s.range > 0.5 && s.score > pickScore) {
        pickScore = s.score;
        pick = b;
        pickAxis = s.axis;
      }
    });
    if (pick < 0) break;
    const box = boxes[pick].slice().sort((a, b) => pts.lab[a * 3 + pickAxis] - pts.lab[b * 3 + pickAxis] || a - b);
    let total = 0;
    for (const i of box) total += pts.weight[i];
    let acc = 0;
    let cut = 1;
    for (let j = 0; j < box.length - 1; j++) {
      acc += pts.weight[box[j]];
      cut = j + 1;
      if (acc >= total / 2) break;
    }
    boxes = [...boxes.slice(0, pick), box.slice(0, cut), box.slice(cut), ...boxes.slice(pick + 1)];
  }
  const labels = new Int32Array(n);
  boxes.forEach((box, b) => box.forEach((i) => (labels[i] = b)));
  // One k-means style refinement step keeps colours representative of their members.
  const q = finish(pts, labels, boxes.length);
  const refined = new Int32Array(n);
  const kk = q.centres.length / 3;
  for (let i = 0; i < n; i++) refined[i] = nearest(pts.lab, i, q.centres, kk);
  return finish(pts, refined, kk);
}

// ---------------------------------------------------------------------------------------------
// Crayon: snap to the named template colours, keep the most used

const CRAYON_SET = Object.entries(TEMPLATE_COLORS).map(([name, hex]) => ({ name, hex, lab: hexToLab(hex) }));

export function crayon(pts: Points, k: number, excludeWhite: boolean): Quantized {
  const n = pts.count;
  const set = excludeWhite ? CRAYON_SET.filter((c) => c.name !== 'White') : CRAYON_SET;
  const dist = (i: number, c: number) =>
    deltaE([pts.lab[i * 3], pts.lab[i * 3 + 1], pts.lab[i * 3 + 2]], set[c].lab);
  const snap = new Int32Array(n);
  const usage = new Float64Array(set.length);
  for (let i = 0; i < n; i++) {
    let best = 0;
    let bestD = Infinity;
    for (let c = 0; c < set.length; c++) {
      const d = dist(i, c);
      if (d < bestD) {
        bestD = d;
        best = c;
      }
    }
    snap[i] = best;
    usage[best] += pts.weight[i];
  }
  const kept = Array.from(set.keys())
    .filter((c) => usage[c] > 0)
    .sort((a, b) => usage[b] - usage[a] || a - b)
    .slice(0, k);
  const keptIndex = new Map(kept.map((c, j) => [c, j]));
  const labels = new Int32Array(n);
  for (let i = 0; i < n; i++) {
    const direct = keptIndex.get(snap[i]);
    if (direct !== undefined) {
      labels[i] = direct;
      continue;
    }
    let best = 0;
    let bestD = Infinity;
    kept.forEach((c, j) => {
      const d = dist(i, c);
      if (d < bestD) {
        bestD = d;
        best = j;
      }
    });
    labels[i] = best;
  }
  const centres: number[] = [];
  for (const c of kept) centres.push(...set[c].lab);
  return { centres, labels, fixed: kept.map((c) => ({ hex: set[c].hex, name: set[c].name })) };
}

// ---------------------------------------------------------------------------------------------
// Posterize: a few levels per sRGB channel, keep the most used bins

export function posterize(pts: Points, k: number): Quantized {
  const n = pts.count;
  const LEVELS = 4;
  const binOf = new Int32Array(n);
  const usage = new Map<number, number>();
  for (let i = 0; i < n; i++) {
    const [r, g, b] = labToRgbBytes(pts.lab[i * 3], pts.lab[i * 3 + 1], pts.lab[i * 3 + 2]);
    const q = (v: number) => Math.min(LEVELS - 1, Math.floor((v * LEVELS) / 256));
    const bin = (q(r) * LEVELS + q(g)) * LEVELS + q(b);
    binOf[i] = bin;
    usage.set(bin, (usage.get(bin) ?? 0) + pts.weight[i]);
  }
  const kept = [...usage.keys()].sort((a, b) => usage.get(b)! - usage.get(a)! || a - b).slice(0, k);
  const keptIndex = new Map(kept.map((b, j) => [b, j]));
  // Colour of a kept bin = mean of its own members.
  const own = new Int32Array(n);
  for (let i = 0; i < n; i++) own[i] = keptIndex.get(binOf[i]) ?? -1;
  const base = finish(
    { lab: pts.lab, weight: pts.weight.map((w, i) => (own[i] >= 0 ? w : 0)), count: n },
    own.map((c) => Math.max(0, c)),
    kept.length,
  );
  // finish() kept every bin (each has members), so indices line up with `kept`.
  const labels = new Int32Array(n);
  const kk = base.centres.length / 3;
  for (let i = 0; i < n; i++) labels[i] = own[i] >= 0 ? own[i] : nearest(pts.lab, i, base.centres, kk);
  return { centres: base.centres, labels };
}
