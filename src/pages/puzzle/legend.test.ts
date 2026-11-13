import { describe, expect, it } from 'vitest';
import { distinctNames, duplicateColorNames } from './legend';

describe('distinctNames', () => {
  it('numbers names that several colours share, ignoring case and spaces', () => {
    expect(distinctNames(['Blue', 'Red', ' blue ', 'Green'])).toEqual(['Blue (1)', 'Red', 'blue (2)', 'Green']);
  });

  it('leaves unique names untouched', () => {
    expect(distinctNames(['Sky', 'Grass'])).toEqual(['Sky', 'Grass']);
  });

  it('never collides with a colour already called "Blue (1)"', () => {
    const out = distinctNames(['Blue', 'Blue (1)', 'Blue']);
    expect(out).toEqual(['Blue (2)', 'Blue (1)', 'Blue (3)']);
    expect(new Set(out.map((n) => n.toLowerCase())).size).toBe(3);
  });
});

describe('duplicateColorNames', () => {
  const palette = [
    { id: 'a', name: 'Blue', hex: '#0000ff' },
    { id: 'b', name: 'blue', hex: '#0000ee' },
    { id: 'c', name: 'Red', hex: '#ff0000' },
    { id: 'd', name: 'Red', hex: '#ee0000' },
  ];

  it('reports names shared by colours used in the picture', () => {
    expect(duplicateColorNames({ palette, cells: ['a', 'b', 'c'] })).toEqual(['Blue']);
  });

  it('ignores colours that are not painted', () => {
    expect(duplicateColorNames({ palette, cells: ['a', 'c'] })).toEqual([]);
  });
});
