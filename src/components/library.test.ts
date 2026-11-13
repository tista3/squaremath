import { describe, expect, it } from 'vitest';
import { cloneDesign } from '../core/design';
import { TEMPLATES } from '../core/samples';
import { findCopyOf, importSummary, todayStamp } from './library';

describe('importSummary', () => {
  it('mentions only the non-zero parts', () => {
    expect(importSummary({ added: 5, skipped: 0, invalid: 0 })).toBe('5 designs added');
    expect(importSummary({ added: 1, skipped: 2, invalid: 3 })).toBe(
      '1 design added · 2 already in your library · 3 could not be read',
    );
  });

  it('counts designs updated to a newer version', () => {
    expect(importSummary({ added: 0, updated: 2, skipped: 1, invalid: 0 })).toBe(
      '2 designs updated to a newer version · 1 already in your library',
    );
  });

  it('says when everything was already there', () => {
    expect(importSummary({ added: 0, skipped: 5, invalid: 0 })).toBe('All 5 designs are already in your library');
    expect(importSummary({ added: 0, skipped: 1, invalid: 0 })).toBe('This design is already in your library');
  });
});

describe('todayStamp', () => {
  it('formats a local date as YYYY-MM-DD', () => {
    expect(todayStamp(new Date(2026, 0, 5))).toBe('2026-01-05');
  });
});

describe('findCopyOf', () => {
  const template = TEMPLATES[0];

  it('finds an unchanged copy, even when renamed', () => {
    const copy = { ...cloneDesign(template), name: 'Mine' };
    expect(findCopyOf([copy], template)).toBe(copy);
  });

  it('prefers the most recently updated copy', () => {
    const older = { ...cloneDesign(template), updatedAt: 1 };
    const newer = { ...cloneDesign(template), updatedAt: 2 };
    expect(findCopyOf([older, newer], template)).toBe(newer);
  });

  it('ignores redrawn copies, other pictures and the source itself', () => {
    const redrawn = cloneDesign(template);
    redrawn.cells[0] = template.palette.find((c) => c.id !== template.cells[0])!.id;
    const recoloured = { ...cloneDesign(template), palette: template.palette.map((c, i) => (i === 0 ? { ...c, hex: '#123456' } : c)) };
    expect(findCopyOf([redrawn, recoloured, template, TEMPLATES[1]], template)).toBeUndefined();
  });
});
