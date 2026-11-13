import { describe, expect, it, vi } from 'vitest';
import type { Design, Expression, LegendEntry, PaletteColor, PuzzleSettings } from '../core/types';
import { DEFAULT_PRINT, DEFAULT_PUZZLE } from '../core/types';

vi.mock('../core/puzzle', () => ({
  formatExpression: (e: Expression) => `${e.a} + ${e.b}`,
  formatLegendValues: (entry: LegendEntry, mode: PuzzleSettings['legendMode']) =>
    mode === 'value' ? entry.values.join(', ') : `${entry.min}–${entry.max}`,
  generatePuzzle: (design: Design) => mockPuzzle(design),
}));

import {
  LEGEND_FS,
  MARGIN,
  pageSizeMm,
  renderDesignSVG,
  renderSheetPages,
  renderSheetSVG,
  sheetCellSizeMm,
  sheetPageCount,
  TILE_MIN_CELL_MM,
  type OkPuzzle,
} from './sheet';
import { textWidth } from './textMetrics';

const RED = { id: 'r', name: 'Red', hex: '#ff0000' };
const WHITE = { id: 'w', name: 'White', hex: '#ffffff' };

function makeDesign(width: number, height: number, overrides: Partial<Design> = {}): Design {
  const cells = Array.from({ length: width * height }, (_, i) => (i % 3 === 0 ? 'r' : 'w'));
  return {
    id: 'd1',
    name: 'Test',
    width,
    height,
    palette: [RED, WHITE],
    backgroundId: 'w',
    cells,
    puzzle: { ...DEFAULT_PUZZLE },
    print: { ...DEFAULT_PRINT },
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  };
}

/** A design using all `names` as colours, in palette order. */
function manyColors(size: number, names: string[], overrides: Partial<Design> = {}): Design {
  const palette: PaletteColor[] = names.map((name, i) => ({ id: `c${i}`, name, hex: '#000000' }));
  const cells = Array.from({ length: size * size }, (_, i) => palette[i % palette.length].id);
  return makeDesign(size, size, { palette, cells, backgroundId: 'c0', ...overrides });
}

/** Legend in palette order with descending numbers, like a shuffled real puzzle; values are 3 per colour. */
function mockPuzzle(design: Design): OkPuzzle {
  const expressions = design.cells.map((id, i) =>
    id === 'r' ? { a: 1 + (i % 5), b: 1, op: 'add' as const, result: 2 + (i % 5) } : { a: 10, b: 2, op: 'add' as const, result: 12 },
  );
  const used = design.palette.filter((c) => design.cells.includes(c.id));
  const legend = used.map((c, k) => {
    const min = (used.length - 1 - k) * 10 + 1;
    return { colorId: c.id, min, max: min + 9, values: [min * 7, min * 7 + 333, min * 7 + 666] };
  });
  return { ok: true, expressions, legend };
}

function parse(svg: string): Document {
  const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
  expect(doc.getElementsByTagName('parsererror')).toHaveLength(0);
  return doc;
}

function gridTexts(doc: Document): Element[] {
  return [...doc.querySelectorAll('g[text-anchor="middle"]:not(.col-labels) > text')];
}

/** Each printed legend line: its x and measured width (bold name runs + regular value runs). */
function legendLines(doc: Document): { x: number; width: number; text: string }[] {
  const out: { x: number; width: number; text: string }[] = [];
  for (const text of doc.querySelectorAll('g.legend > text')) {
    let line = { x: Number(text.getAttribute('x')), width: 0, text: '' };
    out.push(line);
    for (const tspan of text.children) {
      if (tspan.hasAttribute('x')) {
        line = { x: Number(tspan.getAttribute('x')), width: 0, text: '' };
        out.push(line);
      }
      const s = tspan.textContent ?? '';
      line.width += textWidth(s, LEGEND_FS, tspan.getAttribute('font-weight') === 'bold');
      line.text += s;
    }
  }
  return out;
}

function legendEntryTexts(doc: Document): string[] {
  return [...doc.querySelectorAll('g.legend > text')].map((t) => t.textContent ?? '');
}

const NAMES_24 = [
  'White', 'Black', 'Red', 'Very dark bluish green', 'Orange', 'Yellow', 'Light green', 'Green', 'Sky blue', 'Blue',
  'Purple', 'Pink', 'Brown', 'Light gray', 'Gray', "Grandma's sofa", 'Beige', 'Gold', 'Teal', 'Navy', 'Lime',
  'Peach', 'Maroon', 'Olive',
];

describe('pageSizeMm', () => {
  it('uses portrait A4 for square designs and landscape for wide ones', () => {
    expect(pageSizeMm(makeDesign(10, 10))).toEqual({ w: 210, h: 297 });
    expect(pageSizeMm(makeDesign(20, 10))).toEqual({ w: 297, h: 210 });
  });

  it('honours explicit orientation and Letter paper', () => {
    const d = makeDesign(20, 10, { print: { ...DEFAULT_PRINT, paper: 'Letter', orientation: 'portrait' } });
    expect(pageSizeMm(d)).toEqual({ w: 215.9, h: 279.4 });
  });
});

describe('renderSheetSVG', () => {
  it('produces a well-formed mm-sized SVG with one text per cell', () => {
    const d = makeDesign(5, 6);
    const doc = parse(renderSheetSVG(d, mockPuzzle(d), 'puzzle'));
    const root = doc.documentElement;
    expect(root.getAttribute('width')).toBe('210mm');
    expect(root.getAttribute('height')).toBe('297mm');
    expect(root.getAttribute('viewBox')).toBe('0 0 210 297');
    expect(gridTexts(doc)).toHaveLength(30);
    expect(gridTexts(doc)[0].textContent).toBe('1 + 1');
  });

  it('leaves blank (background) cells empty', () => {
    const d = makeDesign(5, 6);
    const full = mockPuzzle(d);
    const puzzle: OkPuzzle = { ...full, expressions: full.expressions.map((e, i) => (d.cells[i] === 'w' ? null : e)) };
    const texts = gridTexts(parse(renderSheetSVG(d, puzzle, 'puzzle')));
    expect(texts).toHaveLength(d.cells.filter((id) => id === 'r').length);
    expect(texts[0].textContent).toBe('1 + 1');
  });

  it('lists colour names and values in the legend, without colour on the puzzle page', () => {
    const d = makeDesign(6, 6);
    const svg = renderSheetSVG(d, mockPuzzle(d), 'puzzle');
    const text = parse(svg).documentElement.textContent ?? '';
    expect(text).toContain('Red');
    expect(text).toContain('White');
    expect(text).toContain('1–10');
    expect(svg).not.toContain('#ff0000');
  });

  it('fills legend swatches when legendSwatches is on', () => {
    const d = makeDesign(6, 6, { print: { ...DEFAULT_PRINT, legendSwatches: true } });
    expect(renderSheetSVG(d, mockPuzzle(d), 'puzzle')).toContain('fill="#ff0000"');
  });

  it('escapes user text for XML', () => {
    const name = `<Red & "Blue">`;
    const d = makeDesign(5, 5, { name, palette: [{ ...RED, name }, WHITE] });
    const doc = parse(renderSheetSVG(d, mockPuzzle(d), 'puzzle'));
    expect(doc.documentElement.textContent).toContain(name);
  });

  it('solution page has coloured cells, no expressions and a check mark', () => {
    const d = makeDesign(6, 6);
    const svg = renderSheetSVG(d, mockPuzzle(d), 'solution');
    const doc = parse(svg);
    expect(gridTexts(doc)).toHaveLength(0);
    expect(svg).toContain('fill="#ff0000"');
    expect(doc.querySelector('path.check')).not.toBeNull();
  });

  it('draws the pencil as a path, so the sheet does not depend on a symbol font', () => {
    const d = makeDesign(6, 6);
    const doc = parse(renderSheetSVG(d, mockPuzzle(d), 'puzzle'));
    expect(doc.querySelector('path.pencil')).not.toBeNull();
    expect(doc.documentElement.textContent).not.toMatch(/[✎✓]/u);
  });

  it('wraps into two lines when cells are too narrow for one', () => {
    const d = makeDesign(40, 40, { print: { ...DEFAULT_PRINT, orientation: 'portrait' } });
    const doc = parse(renderSheetSVG(d, mockPuzzle(d), 'puzzle'));
    const texts = gridTexts(doc);
    expect(texts).toHaveLength(1600);
    expect(texts[0].getElementsByTagName('tspan')).toHaveLength(1);
  });

  it('keeps expressions on one line when cells are big enough', () => {
    const d = makeDesign(10, 10);
    const texts = gridTexts(parse(renderSheetSVG(d, mockPuzzle(d), 'puzzle')));
    expect(texts[0].getElementsByTagName('tspan')).toHaveLength(0);
  });

  it('keeps expression text inside the cell width', () => {
    for (const size of [4, 12, 25, 40]) {
      const d = makeDesign(size, size);
      for (const svg of renderSheetPages(d, mockPuzzle(d), 'puzzle')) {
        const doc = parse(svg);
        const fs = Number(doc.querySelector('g[text-anchor="middle"]:not(.col-labels)')?.getAttribute('font-size'));
        const twoLines = gridTexts(doc)[0].getElementsByTagName('tspan').length > 0;
        const longest = twoLines ? '10 +' : '10 + 2';
        expect(textWidth(longest, fs)).toBeLessThanOrEqual(sheetCellSizeMm(d));
      }
    }
  });
});

describe('legend', () => {
  it('lists range entries in number order, not palette order', () => {
    const d = makeDesign(6, 6);
    const doc = parse(renderSheetSVG(d, mockPuzzle(d), 'puzzle'));
    expect(legendEntryTexts(doc)).toEqual(['White 1–10', 'Red 11–20']);
  });

  it('lists exact-value entries by their smallest value', () => {
    const d = makeDesign(6, 6, { puzzle: { ...DEFAULT_PUZZLE, legendMode: 'value' } });
    const doc = parse(renderSheetSVG(d, mockPuzzle(d), 'puzzle'));
    expect(legendEntryTexts(doc).map((t) => t.split(' ')[0])).toEqual(['White', 'Red']);
  });

  it.each([
    ['A4 portrait', { paper: 'A4' as const, orientation: 'portrait' as const }],
    ['Letter landscape', { paper: 'Letter' as const, orientation: 'landscape' as const }],
    ['A4 landscape', { paper: 'A4' as const, orientation: 'landscape' as const }],
  ])('keeps every key line (also long colour names) inside the page margins: %s', (_label, print) => {
    for (const legendMode of ['range', 'value'] as const) {
      for (const size of [12, 24, 40]) {
        const d = manyColors(size, NAMES_24, { print: { ...DEFAULT_PRINT, ...print }, puzzle: { ...DEFAULT_PUZZLE, legendMode } });
        const { w } = pageSizeMm(d);
        for (const svg of [...renderSheetPages(d, mockPuzzle(d), 'puzzle'), renderSheetSVG(d, mockPuzzle(d), 'puzzle')]) {
          for (const line of legendLines(parse(svg))) {
            expect(line.x).toBeGreaterThanOrEqual(MARGIN);
            expect(line.x + line.width, `${line.text} (${size}×${size}, ${legendMode})`).toBeLessThanOrEqual(w - MARGIN + 1e-6);
          }
        }
      }
    }
  });

  it('wraps a colour name that is wider than the whole page instead of cutting it off', () => {
    const long = 'Extremely long colour name that goes on and on beyond any reasonable width at all, really';
    const d = manyColors(10, ['Red', long]);
    const lines = legendLines(parse(renderSheetSVG(d, mockPuzzle(d), 'puzzle')));
    expect(lines.length).toBeGreaterThan(2);
    for (const line of lines) expect(line.x + line.width).toBeLessThanOrEqual(210 - MARGIN);
    expect(lines.map((l) => l.text).join(' ')).toContain('really');
  });

  it('keeps short entries on one line when there is room', () => {
    const d = manyColors(32, NAMES_24);
    const doc = parse(renderSheetPages(d, mockPuzzle(d), 'puzzle')[0]);
    const entries = [...doc.querySelectorAll('g.legend > text')];
    const wrapped = entries.filter((t) => t.querySelector('tspan[x]'));
    expect(wrapped).toHaveLength(0);
  });
});

describe('split over several pages', () => {
  it('prints small grids on one page', () => {
    const d = makeDesign(12, 12);
    expect(renderSheetPages(d, mockPuzzle(d), 'puzzle')).toHaveLength(1);
    expect(sheetPageCount(d)).toBe(1);
  });

  it('splits a 40×40 puzzle into pages whose squares are big enough to read', () => {
    const d = manyColors(40, NAMES_24);
    const pages = renderSheetPages(d, mockPuzzle(d), 'puzzle');
    expect(pages.length).toBeGreaterThan(1);
    expect(sheetPageCount(d)).toBe(pages.length);
    expect(sheetCellSizeMm(d)).toBeGreaterThanOrEqual(TILE_MIN_CELL_MM);
    // Every square appears exactly once across the pages, and every page repeats the key.
    const total = pages.map((svg) => gridTexts(parse(svg)).length).reduce((a, b) => a + b, 0);
    expect(total).toBe(1600);
    for (const svg of pages) expect(legendEntryTexts(parse(svg))).toHaveLength(24);
  });

  it('numbers rows and columns with their position in the whole picture, and marks the page', () => {
    const d = makeDesign(40, 40);
    const pages = renderSheetPages(d, mockPuzzle(d), 'puzzle').map(parse);
    expect(pages).toHaveLength(4);
    const labels = (doc: Document, cls: string) => [...doc.querySelectorAll(`g.${cls} > text`)].map((t) => Number(t.textContent));
    expect(labels(pages[0], 'col-labels')).toEqual(Array.from({ length: 20 }, (_, i) => i + 1));
    expect(labels(pages[3], 'col-labels')[0]).toBe(21);
    expect(labels(pages[3], 'row-labels').at(-1)).toBe(40);
    const filled = (doc: Document) =>
      [...doc.querySelectorAll('g.tile-map > rect')].findIndex((r) => r.getAttribute('fill') === '#000000');
    expect(pages.map(filled)).toEqual([0, 1, 2, 3]);
  });

  it('keeps the solution on a single page', () => {
    const d = makeDesign(40, 40);
    expect(renderSheetPages(d, mockPuzzle(d), 'solution')).toHaveLength(1);
  });
});

describe('sheetCellSizeMm', () => {
  it('decreases for bigger grids that fit on one page', () => {
    const sizes = [5, 10, 20].map((s) => sheetCellSizeMm(makeDesign(s, s)));
    for (let i = 1; i < sizes.length; i++) expect(sizes[i]).toBeLessThan(sizes[i - 1]);
  });

  it('keeps the whole grid inside the page margins', () => {
    const d = makeDesign(24, 12);
    const { w } = pageSizeMm(d);
    expect(sheetCellSizeMm(d) * 24).toBeLessThanOrEqual(w - 20 + 1e-6);
  });
});

describe('renderDesignSVG', () => {
  it('renders a crisp coloured picture in pixels', () => {
    const d = makeDesign(4, 4);
    const doc = parse(renderDesignSVG(d, { gridLines: true }));
    const root = doc.documentElement;
    expect(root.getAttribute('width')).toBe('64');
    expect(root.getAttribute('shape-rendering')).toBe('crispEdges');
    expect(doc.getElementsByTagName('path')).toHaveLength(1);
  });

  it('adds a one-square white margin and an outline when framed', () => {
    const d = makeDesign(4, 4);
    const doc = parse(renderDesignSVG(d, { cellPx: 10, frame: true }));
    const root = doc.documentElement;
    expect(root.getAttribute('width')).toBe('60');
    expect(root.getAttribute('viewBox')).toBe('-1 -1 6 6');
    expect(doc.querySelector('rect[stroke="#cccccc"]')).not.toBeNull();
  });
});
