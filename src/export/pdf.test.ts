import { describe, expect, it } from 'vitest';
import { jsPDF } from 'jspdf';
import type { Design } from '../core/types';
import { DEFAULT_PRINT, DEFAULT_PUZZLE } from '../core/types';
import { generatePuzzle } from '../core/puzzle';
import { renderSheetPages, type OkPuzzle } from '../render/sheet';
import { drawOps, parsePathData, parseSheetSvg, pdfText, UnsupportedSvgError, type DrawOp } from './pdf';

function makeDesign(overrides: Partial<Design> = {}): Design {
  const width = 6;
  return {
    id: 'd1',
    name: 'Žlutý pták',
    width,
    height: width,
    palette: [
      { id: 'r', name: 'Red', hex: '#ff0000' },
      { id: 'w', name: 'White', hex: '#ffffff' },
    ],
    backgroundId: 'w',
    cells: Array.from({ length: width * width }, (_, i) => (i % 3 === 0 ? 'r' : 'w')),
    puzzle: { ...DEFAULT_PUZZLE, ops: ['sub'], blankBackground: false },
    print: { ...DEFAULT_PRINT, includeSolution: true },
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  };
}

function sheet(design: Design, kind: 'puzzle' | 'solution' = 'puzzle'): string {
  return renderSheetPages(design, generatePuzzle(design) as OkPuzzle, kind)[0];
}

const texts = (ops: DrawOp[]) => ops.flatMap((op) => (op.kind === 'text' ? op.chunks.map((c) => c.runs.map((r) => r.text).join('')) : []));

describe('pdfText', () => {
  it('keeps WinAnsi text (including Central European letters it covers) and swaps the minus sign', () => {
    expect(pdfText('12 − 7')).toBe('12 – 7');
    expect(pdfText('Žlutý pták 3 × 4 ÷ 2 · €')).toBe('Žlutý pták 3 × 4 ÷ 2 · €');
  });

  it('rejects characters the built-in font cannot show', () => {
    expect(() => pdfText('Красный')).toThrow(UnsupportedSvgError);
    expect(() => pdfText('Žluťoučký kůň')).toThrow(UnsupportedSvgError);
  });
});

describe('parsePathData', () => {
  it('reads absolute M/L/H/V/Z paths into polylines', () => {
    expect(parsePathData('M1 2H5V7M0 0L3 4L5 0Z')).toEqual([
      { points: [[1, 2], [5, 2], [5, 7]], closed: false },
      { points: [[0, 0], [3, 4], [5, 0]], closed: true },
    ]);
  });

  it('rejects curves', () => {
    expect(() => parsePathData('M0 0C1 1 2 2 3 3')).toThrow(UnsupportedSvgError);
  });
});

describe('parseSheetSvg', () => {
  it('turns a puzzle sheet into vector shapes and text', () => {
    const ops = parseSheetSvg(sheet(makeDesign({ name: 'Bird' })));
    expect(ops.filter((op) => op.kind === 'text').length).toBeGreaterThanOrEqual(36);
    const all = texts(ops);
    expect(all).toContain('Bird');
    expect(all.some((t) => /^\d+ – \d+$/.test(t))).toBe(true); // "12 − 7" drawn with an en dash
    expect(all.some((t) => t.endsWith(' Red'))).toBe(true); // values and bold name on one line
    const legendLine = ops.find((op) => op.kind === 'text' && op.chunks[0].runs.at(-1)?.text === ' Red');
    expect(legendLine && legendLine.kind === 'text' && legendLine.chunks[0].runs.map((r) => r.bold)).toEqual([false, true]);
  });

  it('centres grid expressions and keeps the coloured fills of the solution', () => {
    const puzzleOps = parseSheetSvg(sheet(makeDesign()));
    expect(puzzleOps.some((op) => op.kind === 'text' && op.anchor === 'middle')).toBe(true);
    const solutionOps = parseSheetSvg(sheet(makeDesign(), 'solution'));
    expect(solutionOps.some((op) => op.kind === 'rect' && op.fill === '#ff0000')).toBe(true);
  });

  it('refuses pages whose text the PDF font cannot show, so the caller can use an image', () => {
    const design = makeDesign({ palette: [{ id: 'r', name: 'Красный', hex: '#ff0000' }, { id: 'w', name: 'White', hex: '#ffffff' }] });
    expect(() => parseSheetSvg(sheet(design))).toThrow(UnsupportedSvgError);
  });

  it('refuses unknown elements', () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="10mm" height="10mm" viewBox="0 0 10 10"><circle r="1"/></svg>';
    expect(() => parseSheetSvg(svg)).toThrow(UnsupportedSvgError);
  });
});

describe('drawOps', () => {
  it('draws a whole sheet into a jsPDF document as text and paths', () => {
    const doc = new jsPDF({ unit: 'mm', format: 'a4', compress: false });
    drawOps(doc, parseSheetSvg(sheet(makeDesign({ name: 'Bird' }))));
    const pdf = doc.output();
    expect(pdf).toContain('(Bird) Tj');
    expect(pdf).toContain('( Red) Tj');
    expect(pdf).not.toContain('/Subtype /Image');
  });
});
