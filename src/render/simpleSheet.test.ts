// Simple-mode sheets with the real generator (sheet.test.ts mocks it), through to the PDF parser.
import { jsPDF } from 'jspdf';
import { describe, expect, it } from 'vitest';
import { generatePuzzle } from '../core/puzzle';
import { PICTOGRAM_SETS, SYMBOL_SETS, SYMBOLS_PER_COLOR, symbolCapacity } from '../core/symbols';
import { DEFAULT_PRINT, DEFAULT_PUZZLE, MAX_PALETTE, type Design } from '../core/types';
import { drawOps, parseSheetSvg } from '../export/pdf';
import { t } from '../i18n';
import { getPictogram, PICTO_BOX, PICTO_DOT_MAX, PICTO_STROKE, SYMBOL_INK } from './pictograms';
import { MARGIN, pageSizeMm, renderSheetPages, type OkPuzzle } from './sheet';

const PICTOGRAMS = Object.values(PICTOGRAM_SETS).flat();

describe('pictograms', () => {
  it.each(PICTOGRAMS)('%s is drawn inside its canvas and has a name', (id) => {
    const { line, dots } = getPictogram(id);
    const points = [...line, ...dots].flatMap((s) => s.points).flat();
    expect(points.length).toBeGreaterThan(0);
    for (const v of points) {
      expect(v).toBeGreaterThanOrEqual(-1);
      expect(v).toBeLessThanOrEqual(PICTO_BOX + 1);
    }
    expect(t(`symbols.${id}`)).not.toBe(`symbols.${id}`);
  });

  // Children colour over them: no solid areas, and little ink altogether.
  it.each(PICTOGRAMS)('%s is light enough to colour over', (id) => {
    const { line, dots } = getPictogram(id);
    let ink = 0;
    for (const { points } of dots) {
      const xs = points.map((p) => p[0]);
      const ys = points.map((p) => p[1]);
      const w = Math.max(...xs) - Math.min(...xs);
      const h = Math.max(...ys) - Math.min(...ys);
      expect(Math.max(w, h)).toBeLessThanOrEqual(2 * PICTO_DOT_MAX + 1e-6);
      ink += (Math.PI * w * h) / 4;
    }
    for (const { points, closed } of line) {
      const path = closed ? [...points, points[0]] : points;
      for (let i = 1; i < path.length; i++) ink += Math.hypot(path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1]) * PICTO_STROKE;
    }
    expect(ink / PICTO_BOX ** 2).toBeLessThan(0.25);
  });
});

function makeDesign(size: number, colors: number, set: (typeof SYMBOL_SETS)[number], perColor: 1 | 2 | 3 | 4): Design {
  const palette = Array.from({ length: colors }, (_, i) => ({ id: `c${i}`, name: `Light colour ${i}`, hex: '#336699' }));
  return {
    id: 'd1',
    name: 'Simple',
    width: size,
    height: size,
    palette,
    backgroundId: 'c0',
    cells: Array.from({ length: size * size }, (_, i) => palette[i % colors].id),
    puzzle: { ...DEFAULT_PUZZLE, simple: { on: true, set, perColor } },
    print: DEFAULT_PRINT,
    createdAt: 0,
    updatedAt: 0,
  };
}

describe('symbol ink', () => {
  /** Fill of every number or letter centred in a square or key box, as the PDF draws it. */
  const centredInk = (design: Design) => {
    const [svg] = renderSheetPages(design, generatePuzzle(design) as OkPuzzle, 'puzzle');
    return new Set(parseSheetSvg(svg).flatMap((op) => (op.kind === 'text' && op.anchor === 'middle' ? [op.fill] : [])));
  };

  it.each(['numbers', 'upper', 'lower'] as const)('%s are grey in the squares and in the key', (set) => {
    expect(centredInk(makeDesign(8, 4, set, 2))).toEqual(new Set([SYMBOL_INK]));
  });

  it('sums stay black', () => {
    const design = makeDesign(8, 4, 'numbers', 1);
    expect(centredInk({ ...design, puzzle: { ...DEFAULT_PUZZLE, blankBackground: false } })).toEqual(new Set(['#000000']));
  });
});

describe('simple sheets', () => {
  for (const set of SYMBOL_SETS) {
    it.each(SYMBOLS_PER_COLOR)(`${set}, %i per colour: the key fits the page and every page is vector PDF`, (perColor) => {
      // The most colours this set can take (one is the blank background, which needs no symbol).
      const colors = Math.min(MAX_PALETTE, symbolCapacity(set) + 1);
      const design = makeDesign(10, colors, set, perColor);
      const puzzle = generatePuzzle(design) as OkPuzzle;
      const page = pageSizeMm(design);
      for (const kind of ['puzzle', 'solution'] as const) {
        for (const svg of renderSheetPages(design, puzzle, kind)) {
          const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
          const boxes = [...doc.querySelectorAll('rect.key-box')];
          expect(boxes).toHaveLength(puzzle.legend.reduce((sum, e) => sum + (e.blank ? 1 : e.symbols!.length), 0));
          for (const box of boxes) {
            const value = (name: string) => Number(box.getAttribute(name));
            expect(value('x') + value('width')).toBeLessThanOrEqual(page.w - MARGIN + 0.05);
            expect(value('y') + value('height')).toBeLessThanOrEqual(page.h - MARGIN + 0.05);
          }
          const ops = parseSheetSvg(svg);
          const pdf = new jsPDF({ unit: 'mm', format: 'a4' });
          expect(() => drawOps(pdf, ops)).not.toThrow();
        }
      }
    });
  }
});
