import { describe, expect, it } from 'vitest';
import { createRng, mixSeed } from './rng';

describe('createRng', () => {
  it('is deterministic for a seed', () => {
    const a = createRng(42);
    const b = createRng(42);
    const seqA = Array.from({ length: 20 }, () => a.next());
    const seqB = Array.from({ length: 20 }, () => b.next());
    expect(seqA).toEqual(seqB);
  });

  it('differs between seeds', () => {
    expect(createRng(1).next()).not.toBe(createRng(2).next());
  });

  it('next() stays in [0,1)', () => {
    const rng = createRng(7);
    for (let i = 0; i < 10000; i++) {
      const x = rng.next();
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(1);
    }
  });

  it('int() is inclusive and roughly uniform', () => {
    const rng = createRng(123);
    const hist = new Array(6).fill(0);
    for (let i = 0; i < 60000; i++) hist[rng.int(1, 6) - 1]++;
    for (const h of hist) expect(Math.abs(h - 10000)).toBeLessThan(600);
    expect(rng.int(5, 5)).toBe(5);
    expect(() => rng.int(3, 2)).toThrow(RangeError);
  });

  it('pick() returns members and rejects empty lists', () => {
    const rng = createRng(9);
    const items = ['a', 'b', 'c'];
    const seen = new Set<string>();
    for (let i = 0; i < 100; i++) seen.add(rng.pick(items));
    expect([...seen].sort()).toEqual(items);
    expect(() => rng.pick([])).toThrow(RangeError);
  });

  it('shuffle() permutes in place', () => {
    const items = Array.from({ length: 50 }, (_, i) => i);
    const out = createRng(5).shuffle(items);
    expect(out).toBe(items);
    expect([...items].sort((a, b) => a - b)).toEqual(Array.from({ length: 50 }, (_, i) => i));
    expect(items).not.toEqual(Array.from({ length: 50 }, (_, i) => i));
  });
});

describe('mixSeed', () => {
  it('returns deterministic uint32 values', () => {
    const h = mixSeed(1, 2, 3);
    expect(h).toBe(mixSeed(1, 2, 3));
    expect(Number.isInteger(h)).toBe(true);
    expect(h).toBeGreaterThanOrEqual(0);
    expect(h).toBeLessThan(2 ** 32);
  });

  it('depends on order, arity and large/negative values', () => {
    expect(mixSeed(1, 2)).not.toBe(mixSeed(2, 1));
    expect(mixSeed(1)).not.toBe(mixSeed(1, 0));
    expect(mixSeed(2 ** 32 + 1)).not.toBe(mixSeed(1));
    expect(mixSeed(-1)).not.toBe(mixSeed(1));
  });

  it('has good avalanche (single-bit change flips ~half the output bits)', () => {
    let flipped = 0;
    const trials = 2000;
    for (let i = 0; i < trials; i++) {
      const x = mixSeed(7, i) ^ mixSeed(7, i ^ 1);
      flipped += popcount(x >>> 0);
    }
    const avg = flipped / trials;
    expect(avg).toBeGreaterThan(14);
    expect(avg).toBeLessThan(18);
  });

  it('produces no collisions for consecutive cell indices', () => {
    const seen = new Set<number>();
    for (let i = 0; i < 5000; i++) seen.add(mixSeed(1, i));
    expect(seen.size).toBe(5000);
  });
});

function popcount(x: number): number {
  let c = 0;
  while (x) {
    x &= x - 1;
    c++;
  }
  return c;
}
