import { describe, expect, it } from 'vitest';
import { createBlankDesign } from './design';
import { STORED_VERSION, libraryToJson, parseLibraryFile, parseStoredLibrary, storedLibraryToJson } from './fileio';
import type { Design } from './types';

/** Blank design with a few coloured cells. */
function painted(name: string, width = 16, height = 16): Design {
  const d = createBlankDesign({ name, width, height });
  const cells = d.cells.map((c, i) => (i % 3 === 0 ? d.palette[i % d.palette.length].id : c));
  return { ...d, cells };
}

describe('library file IO', () => {
  const designs = [createBlankDesign({ name: 'One' }), createBlankDesign({ name: 'Two', width: 8, height: 5 })];

  it('round-trips a library', () => {
    const json = libraryToJson(designs);
    const file = JSON.parse(json);
    expect(file).toMatchObject({ app: 'squaremath', version: 1 });
    expect(typeof file.exportedAt).toBe('number');
    expect(parseLibraryFile(json)).toEqual({ designs, invalid: 0 });
  });

  it('accepts a single design or a bare array', () => {
    expect(parseLibraryFile(JSON.stringify(designs[0]))).toEqual({ designs: [designs[0]], invalid: 0 });
    expect(parseLibraryFile(JSON.stringify(designs))).toEqual({ designs, invalid: 0 });
  });

  it('counts invalid entries', () => {
    const text = JSON.stringify({ app: 'squaremath', version: 1, designs: [designs[0], 5, { foo: 1 }, null] });
    expect(parseLibraryFile(text)).toEqual({ designs: [designs[0]], invalid: 3 });
  });

  it('returns null for garbage', () => {
    for (const text of ['', 'not json', '{', '42', '"str"', 'null', '{"hello":"world"}', '{"designs":"nope"}']) {
      expect(parseLibraryFile(text)).toBeNull();
    }
  });

  it('does not read files from a newer app version as an older format', () => {
    const future = JSON.stringify({ app: 'squaremath', version: STORED_VERSION + 1, designs });
    expect(parseLibraryFile(future)).toBeNull();
  });

  it('also reads the compact storage format', () => {
    const d = painted('Compact');
    expect(parseLibraryFile(storedLibraryToJson([d], []))).toEqual({ designs: [d], invalid: 0 });
  });
});

describe('stored library (local storage format)', () => {
  it('round-trips designs and tombstones with compact cells', () => {
    const designs = [painted('A'), painted('B', 40, 40)];
    const deleted = [{ id: 'gone1', at: 123 }];
    const text = storedLibraryToJson(designs, deleted);
    expect(JSON.parse(text)).toMatchObject({ app: 'squaremath', version: STORED_VERSION });
    expect(parseStoredLibrary(text)).toEqual({ status: 'ok', designs, deleted, invalid: 0 });
  });

  it('is several times smaller than the export format', () => {
    const big = [painted('Big', 40, 40)];
    const stored = storedLibraryToJson(big, []).length;
    expect(stored).toBeLessThan(4000);
    expect(stored * 5).toBeLessThan(libraryToJson(big).length);
  });

  it('reads the old (export) format', () => {
    const designs = [painted('Old')];
    expect(parseStoredLibrary(libraryToJson(designs))).toEqual({ status: 'ok', designs, deleted: [], invalid: 0 });
  });

  it('reports unreadable, partly invalid and newer-version data', () => {
    expect(parseStoredLibrary('{oops')).toEqual({ status: 'unreadable' });
    expect(parseStoredLibrary('{"app":"squaremath","version":2,"designs":{"a":1}}')).toEqual({ status: 'unreadable' });
    const d = painted('Ok');
    const partly = JSON.stringify({ app: 'squaremath', version: 2, designs: [{ ...d, cells: 'x' }, { nope: 1 }] });
    expect(parseStoredLibrary(partly)).toMatchObject({ status: 'ok', invalid: 1 });
    const newer = JSON.stringify({ app: 'squaremath', version: 3, designs: [d] });
    expect(parseStoredLibrary(newer)).toEqual({ status: 'newer', designs: [d] });
    expect(parseStoredLibrary('{"app":"squaremath","version":9,"designs":{"a":1}}')).toEqual({ status: 'newer', designs: [] });
  });

  it('drops malformed tombstones', () => {
    const text = JSON.stringify({ version: 2, designs: [], deleted: [{ id: 'ok1', at: 5 }, { id: '..', at: 5 }, { id: 'x', at: -1 }, 7, null] });
    expect(parseStoredLibrary(text)).toEqual({ status: 'ok', designs: [], deleted: [{ id: 'ok1', at: 5 }], invalid: 0 });
  });
});
