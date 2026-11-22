// OWNER: image-core agent. Linear-time raster filters for the drawing pipeline (radius does not affect speed).

/** Calls fn with each neighbour (4-connected) of pixel i in a w × h image. */
export function forEach4(i: number, w: number, h: number, fn: (j: number) => void): void {
  const x = i % w;
  if (x > 0) fn(i - 1);
  if (x < w - 1) fn(i + 1);
  if (i >= w) fn(i - w);
  if (i < w * (h - 1)) fn(i + w);
}

/**
 * Box means of any radius in constant time per pixel, from one summed-area table: returns a function that
 * gives the mean over a (2r+1)² window, clipped at the image edge, of an interleaved 3-channel buffer.
 */
export function boxMeans(src: ArrayLike<number>, w: number, h: number): (r: number) => Float32Array {
  const stride = (w + 1) * 3;
  const sum = new Float64Array(stride * (h + 1));
  for (let y = 0; y < h; y++) {
    let a = 0, b = 0, c = 0;
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 3;
      const o = (y + 1) * stride + (x + 1) * 3;
      a += src[i];
      b += src[i + 1];
      c += src[i + 2];
      sum[o] = sum[o - stride] + a;
      sum[o + 1] = sum[o - stride + 1] + b;
      sum[o + 2] = sum[o - stride + 2] + c;
    }
  }
  return (r) => {
    const out = new Float32Array(w * h * 3);
    for (let y = 0; y < h; y++) {
      const y0 = y > r ? y - r : 0;
      const y1 = y + r + 1 < h ? y + r + 1 : h;
      const top = y0 * stride;
      const bottom = y1 * stride;
      for (let x = 0; x < w; x++) {
        const x0 = x > r ? x - r : 0;
        const x1 = x + r + 1 < w ? x + r + 1 : w;
        const scale = 1 / ((y1 - y0) * (x1 - x0));
        const left = x0 * 3;
        const right = x1 * 3;
        const o = (y * w + x) * 3;
        out[o] = (sum[bottom + right] - sum[bottom + left] - sum[top + right] + sum[top + left]) * scale;
        out[o + 1] = (sum[bottom + right + 1] - sum[bottom + left + 1] - sum[top + right + 1] + sum[top + left + 1]) * scale;
        out[o + 2] = (sum[bottom + right + 2] - sum[bottom + left + 2] - sum[top + right + 2] + sum[top + left + 2]) * scale;
      }
    }
    return out;
  };
}

/** Sliding maximum (sign 1) or minimum (sign −1) over a (2r+1)² window (van Herk / Gil–Werman). */
function extreme(src: Float32Array, w: number, h: number, r: number, sign: 1 | -1): Float32Array {
  const tmp = new Float32Array(src.length);
  const out = new Float32Array(src.length);
  const size = 2 * r + 1;
  const padded = Math.max(w, h) + 2 * r;
  const line = new Float32Array(padded);
  const fromLeft = new Float32Array(padded);
  const fromRight = new Float32Array(padded);
  const pass = (from: Float32Array, to: Float32Array, lines: number, len: number, step: number, gap: number) => {
    const total = len + 2 * r;
    for (let l = 0; l < lines; l++) {
      const base = l * gap;
      line.fill(-Infinity, 0, total);
      for (let p = 0; p < len; p++) line[p + r] = sign * from[base + p * step];
      let best = -Infinity;
      for (let p = 0, block = 0; p < total; p++) {
        const v = line[p];
        if (block === 0 || v > best) best = v;
        fromLeft[p] = best;
        if (++block === size) block = 0;
      }
      best = -Infinity;
      for (let p = total - 1, block = (total - 1) % size; p >= 0; p--) {
        const v = line[p];
        if (v > best) best = v;
        fromRight[p] = best;
        if (block-- === 0) {
          block = size - 1;
          best = -Infinity;
        }
      }
      for (let p = 0; p < len; p++) {
        const a = fromRight[p];
        const b = fromLeft[p + size - 1];
        to[base + p * step] = sign * (a > b ? a : b);
      }
    }
  };
  pass(src, tmp, h, w, 1, w);
  pass(tmp, out, w, h, w, 1);
  return out;
}

/**
 * Black-hat filter (closing − value): how much darker a pixel is than its surroundings, for dark features
 * narrower than 2r+1 pixels (drawn strokes, pupils). Wide dark areas and plain edges score 0.
 */
export function blackHat(src: Float32Array, w: number, h: number, r: number): Float32Array {
  const out = extreme(extreme(src, w, h, r, 1), w, h, r, -1);
  for (let i = 0; i < out.length; i++) out[i] -= src[i];
  return out;
}

/** 8-connected steps to the nearest set pixel, capped at `max` (≤ 255). */
export function stepsTo(set: Uint8Array, w: number, h: number, max: number): Uint8Array {
  const out = new Uint8Array(w * h);
  for (let i = 0; i < out.length; i++) out[i] = set[i] ? 0 : max;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      let v = out[i];
      if (x > 0) v = Math.min(v, out[i - 1] + 1);
      if (y > 0) {
        v = Math.min(v, out[i - w] + 1);
        if (x > 0) v = Math.min(v, out[i - w - 1] + 1);
        if (x < w - 1) v = Math.min(v, out[i - w + 1] + 1);
      }
      out[i] = v;
    }
  }
  for (let y = h - 1; y >= 0; y--) {
    for (let x = w - 1; x >= 0; x--) {
      const i = y * w + x;
      let v = out[i];
      if (x < w - 1) v = Math.min(v, out[i + 1] + 1);
      if (y < h - 1) {
        v = Math.min(v, out[i + w] + 1);
        if (x > 0) v = Math.min(v, out[i + w - 1] + 1);
        if (x < w - 1) v = Math.min(v, out[i + w + 1] + 1);
      }
      out[i] = v;
    }
  }
  return out;
}
