// OWNER: core-puzzle agent. Seeded deterministic PRNG (mulberry32) + murmur3-style seed mixing.
export type Rng = {
  /** float in [0,1) */
  next(): number;
  /** integer in [min, max] inclusive */
  int(min: number, max: number): number;
  pick<T>(items: readonly T[]): T;
  /** In-place Fisher-Yates; returns the same array. */
  shuffle<T>(items: T[]): T[];
};

const UINT32 = 4294967296;

export function createRng(seed: number): Rng {
  let state = toUint32(seed);

  const next = (): number => {
    state = (state + 0x6d2b79f5) | 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / UINT32;
  };

  const int = (min: number, max: number): number => {
    const lo = Math.ceil(min);
    const hi = Math.floor(max);
    if (!(hi >= lo)) throw new RangeError(`rng.int: empty range [${min}, ${max}]`);
    return lo + Math.floor(next() * (hi - lo + 1));
  };

  const pick = <T>(items: readonly T[]): T => {
    if (items.length === 0) throw new RangeError('rng.pick: empty list');
    return items[Math.floor(next() * items.length)];
  };

  const shuffle = <T>(items: T[]): T[] => {
    for (let i = items.length - 1; i > 0; i--) {
      const j = Math.floor(next() * (i + 1));
      [items[i], items[j]] = [items[j], items[i]];
    }
    return items;
  };

  return { next, int, pick, shuffle };
}

/** Mix several integers into one uint32 seed (e.g. mixSeed(seed, cellIndex)). */
export function mixSeed(...parts: number[]): number {
  let h = (0x9e3779b9 ^ parts.length) >>> 0;
  for (const part of parts) {
    // Fold in both 32-bit halves so large/negative numbers still contribute fully.
    const n = Number.isFinite(part) ? Math.trunc(part) : 0;
    h = mixWord(h, toUint32(n));
    h = mixWord(h, toUint32(Math.floor(n / UINT32)));
  }
  return fmix32(h);
}

function toUint32(n: number): number {
  return Number.isFinite(n) ? Math.trunc(n) >>> 0 : 0;
}

function rotl(x: number, r: number): number {
  return (x << r) | (x >>> (32 - r));
}

/** One murmur3 block step. */
function mixWord(h: number, word: number): number {
  let k = Math.imul(word, 0xcc9e2d51);
  k = rotl(k, 15);
  k = Math.imul(k, 0x1b873593);
  h ^= k;
  h = rotl(h, 13);
  return (Math.imul(h, 5) + 0xe6546b64) >>> 0;
}

/** murmur3 finaliser: full avalanche. */
function fmix32(h: number): number {
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}
