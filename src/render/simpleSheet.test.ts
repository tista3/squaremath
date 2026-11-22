// Simple-mode sheets with the real generator (sheet.test.ts mocks it), through to the PDF parser.
import { jsPDF } from 'jspdf';
import { describe, expect, it } from 'vitest';
import { generatePuzzle } from '../core/puzzle';
import { PICTOGRAM_SETS, SYMBOL_SETS, SYMBOLS_PER_COLOR, symbolCapacity } from '../core/symbols';
import { DEFAULT_PRINT, DEFAULT_PUZZLE, MAX_PALETTE, type Design } from '../core/types';
import { drawOps, parseSheetSvg } from '../export/pdf';
import { t } from '../i18n';
import { getPictogram, PICTO_BOX } from './pictograms';
import { MARGIN, pageSizeMm, renderSheetPages, type OkPuzzle } from './sheet';

const PICTOGRAMS = Object.values(PICTOGRAM_SETS).flat();

describe('pictograms', () => {
  it.each(PICTOGRAMS)('%s is drawn inside its canvas and has a name', (id) => {
    const { line, fill } = getPictogram(id);
    const points = [...line, ...fill].flatMap((s) => s.points).flat();
    expect(points.length).toBeGreaterThan(0);
    for (const v of points) {
      expect(v).toBeGreaterThanOrEqual(-1);
      expect(v).toBeLessThanOrEqual(PICTO_BOX + 1);
    }
    expect(t(`symbols.${id}`)).not.toBe(`symbols.${id}`);
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
