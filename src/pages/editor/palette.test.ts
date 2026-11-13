import { describe, expect, it } from 'vitest';
import { CRAYONS } from '../../core/colors';
import { countCells, cycleColorId, duplicateNames, hasHex, nextFreshColor, paintedCount, recolor, resolveSelected, uniqueName } from './palette';

const pal = [
  { id: 'w', name: 'White', hex: '#ffffff' },
  { id: 'r', name: 'Red', hex: '#ff0000' },
  { id: 'b', name: 'Blue', hex: '#0000ff' },
];

describe('palette helpers', () => {
  it('counts cells', () => {
    const c = countCells(['w', 'r', 'r']);
    expect(c.get('r')).toBe(2);
    expect(c.get('b')).toBeUndefined();
  });
  it('finds duplicate names ignoring case and spaces', () => {
    expect(duplicateNames(pal)).toEqual([]);
    expect(duplicateNames([...pal, { id: 'x', name: ' red ', hex: '#ee0000' }])).toEqual(['Red']);
  });
  it('counts painted cells', () => {
    expect(paintedCount({ cells: ['w', 'r', 'b', 'w'], backgroundId: 'w' })).toBe(2);
  });
  it('recolor follows auto-name but keeps custom names', () => {
    const suggest = (hex: string) => (hex === '#ff0000' ? 'Red' : 'Green');
    expect(recolor(pal[1], '#00ff00', suggest)).toEqual({ id: 'r', name: 'Green', hex: '#00ff00' });
    expect(recolor({ ...pal[1], name: 'Lava' }, '#00ff00', suggest).name).toBe('Lava');
  });
  it('resolves selection', () => {
    expect(resolveSelected(pal, 'w', 'b')).toBe('b');
    expect(resolveSelected(pal, 'w', 'gone')).toBe('r');
    expect(resolveSelected(pal, 'w', null)).toBe('r');
    expect(resolveSelected([pal[0]], 'w', null)).toBe('w');
  });
  it('cycles with wrap-around', () => {
    expect(cycleColorId(pal, 'b', 1)).toBe('w');
    expect(cycleColorId(pal, 'w', -1)).toBe('b');
    expect(cycleColorId(pal, 'r', 1)).toBe('b');
  });
});

describe('adding colours without duplicates', () => {
  const hexOf = (name: string) => CRAYONS.find((c) => c.name === name)!.hex;

  it('uniqueName numbers a taken name', () => {
    expect(uniqueName('Green', pal)).toBe('Green');
    expect(uniqueName('Red', pal)).toBe('Red 2');
    expect(uniqueName(' red ', [...pal, { id: 'r2', name: 'Red 2', hex: '#ee0000' }])).toBe('red 3');
  });
  it('hasHex ignores case', () => {
    expect(hasHex(pal, '#FF0000')).toBe(true);
    expect(hasHex(pal, '#00ff00')).toBe(false);
  });
  it('offers a preset whose hex and name are unused', () => {
    expect(nextFreshColor(pal)).toBe(hexOf('Orange'));
    const withOrange = [...pal, { id: 'o', name: 'Orange', hex: hexOf('Orange') }];
    expect(nextFreshColor(withOrange)).toBe(hexOf('Yellow'));
  });
  it('moves on after the colour just added, skipping used names', () => {
    const withOrange = [...pal, { id: 'o', name: 'Orange', hex: hexOf('Orange') }];
    expect(nextFreshColor(withOrange, hexOf('Orange'))).toBe(hexOf('Yellow'));
    // "Red" is taken by name (different hex), so Red is skipped after Pink.
    expect(nextFreshColor(withOrange, hexOf('Pink'))).toBe(hexOf('Brown'));
  });
  it('repeated adds never repeat a colour', () => {
    let palette = [...pal];
    let hex: string | undefined;
    for (let i = 0; i < 10; i++) {
      hex = nextFreshColor(palette, hex);
      expect(hasHex(palette, hex)).toBe(false);
      palette = [...palette, { id: `c${i}`, name: CRAYONS.find((c) => c.hex === hex)!.name, hex }];
    }
    expect(duplicateNames(palette)).toEqual([]);
  });
  it('falls back to the current colour when every preset is used', () => {
    const all = CRAYONS.map((c, i) => ({ id: `c${i}`, ...c }));
    expect(nextFreshColor(all, '#123456')).toBe('#123456');
  });
});
