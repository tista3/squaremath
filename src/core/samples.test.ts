import { describe, expect, it } from 'vitest';
import { decodeDesign, encodeDesign } from './codec';
import { normalizeDesign, usedColorIds } from './design';
import { generatePuzzle, puzzleWarnings } from './puzzle';
import { TEMPLATE_CATEGORIES, TEMPLATES, templateCategory } from './samples';
import type { Design } from './types';

function content(d: Design) {
  const { id: _id, createdAt: _c, updatedAt: _u, palette, backgroundId, cells, ...rest } = d;
  const index = new Map(palette.map((c, i) => [c.id, i]));
  return {
    ...rest,
    palette: palette.map((c) => [c.name, c.hex]),
    background: index.get(backgroundId),
    cells: cells.map((c) => index.get(c)),
  };
}

describe('built-in templates', () => {
  it('has at least 10 templates with unique fixed ids', () => {
    expect(TEMPLATES.length).toBeGreaterThanOrEqual(10);
    const ids = TEMPLATES.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^tpl-[a-z0-9]+(-[a-z0-9]+)*$/);
  });

  it.each(TEMPLATES.map((t) => [t.id, t] as const))('%s is valid, uses every colour and is in range', (_, t) => {
    expect(normalizeDesign(t)).toEqual(t);
    expect(usedColorIds(t)).toEqual(t.palette.map((c) => c.id));
    expect(t.palette.length).toBeGreaterThanOrEqual(2);
    expect(t.palette.length).toBeLessThanOrEqual(8);
    expect(Math.min(t.width, t.height)).toBeGreaterThanOrEqual(8);
    // Larger grids print too small to read comfortably on one page.
    expect(Math.max(t.width, t.height)).toBeLessThanOrEqual(24);
    expect(TEMPLATE_CATEGORIES).toContain(templateCategory(t.id));
    expect([t.createdAt, t.updatedAt]).toEqual([0, 0]);
  });

  it.each(TEMPLATES.map((t) => [t.id, t] as const))('%s round-trips through the share codec', (_, t) => {
    expect(content(decodeDesign(encodeDesign(t))!)).toEqual(content(t));
  });

  it.each(TEMPLATES.map((t) => [t.id, t] as const))('%s yields a solvable puzzle', (_, t) => {
    const result = generatePuzzle(t);
    expect(result.ok).toBe(true);
    expect(puzzleWarnings(t, result).map((w) => w.code)).toEqual([]);
  });
});
