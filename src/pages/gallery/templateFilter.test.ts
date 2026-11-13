import { describe, expect, it } from 'vitest';
import { TEMPLATES, TEMPLATE_CATEGORIES, templateCategory } from '../../core/samples';
import type { Design, Op } from '../../core/types';
import { t } from '../../i18n';
import { categoryCounts, filterTemplates, NO_FILTER, opsLevel, opsLevelsPresent, parseFilter } from './templateFilter';

function fake(id: string, ops: Op[]): Design {
  return { ...TEMPLATES[0], id, puzzle: { ...TEMPLATES[0].puzzle, ops } };
}

const CATS: Record<string, 'animals' | 'food'> = { a1: 'animals', a2: 'animals', f1: 'food' };
const categoryOf = (id: string) => CATS[id];
const LIST = [fake('a1', ['add']), fake('a2', ['mul', 'div']), fake('f1', ['add', 'sub', 'mul'])];

describe('opsLevel', () => {
  it('classifies the kind of maths', () => {
    expect(opsLevel(['add'])).toBe('addsub');
    expect(opsLevel(['add', 'sub'])).toBe('addsub');
    expect(opsLevel(['div'])).toBe('muldiv');
    expect(opsLevel(['sub', 'mul'])).toBe('mixed');
  });
});

describe('filterTemplates', () => {
  it('filters by category and kind of maths', () => {
    expect(filterTemplates(LIST, NO_FILTER, categoryOf)).toHaveLength(3);
    expect(filterTemplates(LIST, { category: 'animals', ops: 'all' }, categoryOf).map((d) => d.id)).toEqual(['a1', 'a2']);
    expect(filterTemplates(LIST, { category: 'animals', ops: 'muldiv' }, categoryOf).map((d) => d.id)).toEqual(['a2']);
    expect(filterTemplates(LIST, { category: 'food', ops: 'addsub' }, categoryOf)).toEqual([]);
  });
});

describe('categoryCounts', () => {
  it('lists All plus only the categories that have templates, counted under the maths filter', () => {
    expect(categoryCounts(LIST, 'all', categoryOf)).toEqual([
      { category: 'all', count: 3 },
      { category: 'animals', count: 2 },
      { category: 'food', count: 1 },
    ]);
    expect(categoryCounts(LIST, 'addsub', categoryOf)).toEqual([
      { category: 'all', count: 1 },
      { category: 'animals', count: 1 },
      { category: 'food', count: 0 },
    ]);
  });

  it('covers every built-in template, with a label for each chip', () => {
    const chips = categoryCounts(TEMPLATES, 'all', templateCategory);
    expect(chips[0]).toEqual({ category: 'all', count: TEMPLATES.length });
    expect(chips.slice(1).reduce((sum, c) => sum + c.count, 0)).toBe(TEMPLATES.length);
    for (const c of ['all', ...TEMPLATE_CATEGORIES]) expect(t(`gallery.category_${c}`)).not.toBe(`gallery.category_${c}`);
    for (const l of opsLevelsPresent(TEMPLATES)) expect(t(`gallery.ops_${l}`)).not.toBe(`gallery.ops_${l}`);
  });
});

describe('parseFilter', () => {
  it('reads a stored filter and drops unknown values', () => {
    expect(parseFilter(JSON.stringify({ category: 'food', ops: 'muldiv' }))).toEqual({ category: 'food', ops: 'muldiv' });
    expect(parseFilter(JSON.stringify({ category: 'dinosaurs', ops: 7 }))).toEqual(NO_FILTER);
    expect(parseFilter('not json')).toEqual(NO_FILTER);
    expect(parseFilter('null')).toEqual(NO_FILTER);
    expect(parseFilter(null)).toEqual(NO_FILTER);
  });
});
