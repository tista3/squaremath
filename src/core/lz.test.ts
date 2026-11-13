import { compressToEncodedURIComponent, decompressFromEncodedURIComponent } from 'lz-string';
import { describe, expect, it } from 'vitest';
import { decompressFromUriBounded } from './lz';
import { createRng } from './rng';

describe('decompressFromUriBounded', () => {
  it('matches lz-string on varied input', () => {
    const rng = createRng(42);
    const alphabet = 'aab01[]",~ ÄÖ÷€\u{1F600}漢字';
    const chars = Array.from(alphabet);
    for (let n = 0; n < 100; n++) {
      const length = rng.int(1, 3000);
      let text = '';
      for (let i = 0; i < length; i++) text += rng.pick(chars);
      const packed = compressToEncodedURIComponent(text);
      expect(decompressFromUriBounded(packed, 1_000_000)).toBe(text);
      expect(decompressFromUriBounded(packed, 1_000_000)).toBe(decompressFromEncodedURIComponent(packed));
    }
  });

  it('treats spaces as "+" like lz-string', () => {
    const texts = Array.from({ length: 500 }, (_, i) => `text ${i} ÷ ${i * 7919}`);
    const text = texts.find((s) => compressToEncodedURIComponent(s).includes('+'))!;
    expect(text).toBeDefined();
    const mangled = compressToEncodedURIComponent(text).replace(/\+/g, ' ');
    expect(decompressFromUriBounded(mangled, 1000)).toBe(text);
  });

  it('gives up as soon as the output passes the limit (decompression bomb)', () => {
    // A tiny payload that expands to a huge string: lz output grows quadratically with the input.
    const bomb = compressToEncodedURIComponent('a'.repeat(400_000));
    expect(bomb.length).toBeLessThan(5_000);
    expect(decompressFromUriBounded(bomb, 100_000)).toBeNull();
    expect(decompressFromUriBounded(bomb, 400_000)).toBe('a'.repeat(400_000));
    expect(decompressFromUriBounded(compressToEncodedURIComponent('a'.repeat(1000)), 1000)).toBe('a'.repeat(1000));
    expect(decompressFromUriBounded(compressToEncodedURIComponent('a'.repeat(1001)), 1000)).toBeNull();
  });

  it('returns null for empty, truncated or corrupt input', () => {
    const packed = compressToEncodedURIComponent('some text to compress, some text');
    expect(decompressFromUriBounded('', 1000)).toBeNull();
    expect(decompressFromUriBounded(packed.slice(0, 5), 1000)).toBeNull();
    for (const junk of ['$$$$$$$$$$', '////', 'zzzzzzzzzzzzzzzzzzzz']) {
      const out = decompressFromUriBounded(junk, 1000);
      expect(out === null || out.length <= 1000).toBe(true);
    }
  });
});
