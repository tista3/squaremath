import { describe, expect, it } from 'vitest';
import { CRAYONS, nearestColorName, normalizeHex, textColorFor } from './colors';
import { BASIC_COLORS } from './design';

describe('CRAYONS', () => {
  it('has unique names and valid lowercase hexes', () => {
    expect(CRAYONS.length).toBeGreaterThanOrEqual(30);
    expect(new Set(CRAYONS.map((c) => c.name)).size).toBe(CRAYONS.length);
    for (const c of CRAYONS) expect(c.hex).toMatch(/^#[0-9a-f]{6}$/);
  });

  it('maps each crayon to its own name', () => {
    for (const c of CRAYONS) expect(nearestColorName(c.hex)).toBe(c.name);
  });

  // The editor treats a name equal to nearestColorName(hex) as auto-suggested and renames it on recolour.
  it('maps every default palette colour back to its own name', () => {
    for (const [name, hex] of Object.entries(BASIC_COLORS)) expect(nearestColorName(hex)).toBe(name);
  });
});

describe('nearestColorName', () => {
  it.each([
    ['#ff0000', 'Red'],
    ['#000000', 'Black'],
    ['#ffffff', 'White'],
    ['#008000', 'Green'],
    ['#00ff00', 'Lime'],
    ['#0000ff', 'Royal blue'],
    ['#2196f3', 'Blue'],
    ['#1e88e5', 'Blue'],
    ['#ffff00', 'Yellow'],
    ['#808080', 'Gray'],
    ['#ffa500', 'Orange'],
    ['#ff00ff', 'Magenta'],
    ['#000080', 'Navy'],
    ['#8b4513', 'Chestnut'],
    ['#795548', 'Brown'],
    ['#607d8b', 'Blue gray'],
    ['#3f51b5', 'Indigo'],
    ['#e91e63', 'Hot pink'],
    ['#ffffe0', 'Cream'],
    ['#fffacd', 'Cream'],
    ['#c5cae9', 'Lavender'],
    ['#4fc3f7', 'Sky blue'],
    ['#ff69b4', 'Pink'],
    ['#ffc0cb', 'Light pink'],
  ])('%s → %s', (hex, name) => {
    expect(nearestColorName(hex)).toBe(name);
  });

  it('accepts short and uppercase input', () => {
    expect(nearestColorName('F00')).toBe('Red');
  });
});

describe('normalizeHex', () => {
  it.each([
    ['#abc', '#aabbcc'],
    ['abc', '#aabbcc'],
    ['#AABBCC', '#aabbcc'],
    ['AABBCC', '#aabbcc'],
    ['  #12aB9f ', '#12ab9f'],
  ])('%s → %s', (input, out) => {
    expect(normalizeHex(input)).toBe(out);
  });

  it.each(['', '#', '#ab', '#abcd', '#abcdeg', 'red', '##abc', '#aabbccdd'])('rejects %j', (input) => {
    expect(normalizeHex(input)).toBeNull();
  });
});

describe('textColorFor', () => {
  it('chooses the higher-contrast text colour', () => {
    expect(textColorFor('#ffffff')).toBe('#000000');
    expect(textColorFor('#fdd835')).toBe('#000000');
    expect(textColorFor('#000000')).toBe('#ffffff');
    expect(textColorFor('#1a237e')).toBe('#ffffff');
    expect(textColorFor('#e53935')).toBe('#000000');
    expect(textColorFor('#b71c1c')).toBe('#ffffff');
  });

  it('falls back to black for invalid input', () => {
    expect(textColorFor('nope')).toBe('#000000');
  });
});
