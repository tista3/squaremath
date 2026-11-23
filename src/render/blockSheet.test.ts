// Sheets of puzzles with blocks, with the real generator (sheet.test.ts mocks it), through to the PDF parser.
import { jsPDF } from 'jspdf';
import { describe, expect, it } from 'vitest';
import type { BlockSettings } from '../core/blocks';
import { generatePuzzle } from '../core/puzzle';
import { DEFAULT_PRINT, DEFAULT_PUZZLE, type Design, type PuzzleSettings } from '../core/types';
import { drawOps, parseSheetSvg } from '../export/pdf';
import { renderSheetPages, type OkPuzzle } from './sheet';
import { textWidth } from './textMetrics';

const ON: BlockSettings = { on: true, hideOutline: false, harderSums: true };

/** Flat rectangles of four colours on a white background, so blocks of every size form. */
function design(size: number, puzzle: Partial<PuzzleSettings> = {}): Design {
  const palette = ['White', 'Red', 'Blue', 'Green'].map((name, i) => ({ id: `c${i}`, name, hex: ['#ffffff', '#e53935', '#1e88e5', '#43a047'][i] }));
  const cells = Array.from({ length: size * size }, (_, i) => palette[(Math.floor((i % size) / 5) + Math.floor(i / size / 4)) % 4].id);
  return {
    id: 'd1',
    name: 'Blocks',
    width: size,
    height: size,
    palette,
    backgroundId: 'c0',
    cells,
    puzzle: { ...DEFAULT_PUZZLE, ops: ['add', 'sub'], addSubMax: 50, blocks: ON, ...puzzle },
    print: { ...DEFAULT_PRINT },
    createdAt: 0,
    updatedAt: 0,
  };
}

function puzzleOf(d: Design): OkPuzzle {
  const res = generatePuzzle(d);
  if (!res.ok) throw new Error('puzzle failed');
  return res;
}

/** Text contents of the grid (the first <g text-anchor="middle"> after the header). */
function gridTexts(svg: string): { text: string; lines: string[]; x: number; y: number; fs: number }[] {
  const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
  const grid = [...doc.querySelectorAll('g[text-anchor="middle"]')].find((g) => !g.closest('.legend') && !g.classList.contains('col-labels'))!;
  return [...grid.querySelectorAll(':scope > g > text')].map((t) => ({
    text: [...t.childNodes].map((n) => n.textContent).join(' '),
    lines: [...t.childNodes].map((n) => n.textContent ?? ''),
    x: Number(t.getAttribute('x')),
    y: Number(t.getAttribute('y')),
    fs: Number(t.parentElement!.getAttribute('font-size')),
  }));
}

describe('sheets with blocks', () => {
  it('print one sum per block, not one per square', () => {
    const d = design(16);
    const puzzle = puzzleOf(d);
    const [page] = renderSheetPages(d, puzzle, 'puzzle');
    expect(gridTexts(page)).toHaveLength(puzzle.blocks!.length);
    expect(puzzle.blocks!.length).toBeLessThan(d.cells.filter((c) => c !== 'c0').length / 2);
  });

  it('print longer sums in big blocks, bigger than in single squares and inside their block', () => {
    const d = design(16);
    const puzzle = puzzleOf(d);
    const texts = gridTexts(renderSheetPages(d, puzzle, 'puzzle')[0]);
    const long = texts.filter((t) => t.text.split(' ').length >= 5);
    const short = texts.filter((t) => t.text.split(' ').length === 3);
    expect(long.length).toBeGreaterThan(0);
    // Every text fits the width of its block (blocks are 1–3 squares wide, the widest text is in a 3-wide one).
    const svg = renderSheetPages(d, puzzle, 'puzzle')[0];
    const frame = /<rect x="([\d.]+)" y="([\d.]+)" width="([\d.]+)" height="[\d.]+" fill="none" stroke="#000" stroke-width="0.5"/.exec(svg)!;
    const cell = Number(frame[3]) / d.width;
    for (const t of texts) {
      const width = Math.max(...t.lines.map((line) => textWidth(line, t.fs)));
      expect(width).toBeLessThanOrEqual(3 * cell);
    }
    if (short.length) expect(Math.max(...long.map((t) => t.fs))).toBeGreaterThan(Math.min(...short.map((t) => t.fs)));
  });

  it('draw faint lines inside blocks and dark ones along their edges', () => {
    const d = design(16);
    const svg = renderSheetPages(d, puzzleOf(d), 'puzzle')[0];
    expect(svg).toContain('stroke="#c4c4c4"');
    expect(svg).toContain('stroke="#333333"');
    const off = { ...d, puzzle: { ...d.puzzle, blocks: { ...ON, on: false } } };
    expect(renderSheetPages(off, puzzleOf(off), 'puzzle')[0]).not.toContain('stroke="#c4c4c4"');
  });

  it('repeat the sum of a block cut by a page edge on both pages', () => {
    // 38 squares split into pages of 19: the blocks of the 5-wide stripes (3 + 2) do not end at 19.
    const d = design(38);
    const puzzle = puzzleOf(d);
    const pages = renderSheetPages(d, puzzle, 'puzzle');
    expect(pages.length).toBeGreaterThan(1);
    const printed = pages.reduce((sum, page) => sum + gridTexts(page).length, 0);
    expect(printed).toBeGreaterThan(puzzle.blocks!.length);
  });

  it('can be drawn as PDF vectors', () => {
    for (const simple of [false, true]) {
      const d = design(40, simple ? { simple: { on: true, set: 'animals', perColor: 2 } } : {});
      const pdf = new jsPDF({ unit: 'mm', format: 'a4' });
      for (const page of renderSheetPages(d, puzzleOf(d), 'puzzle')) expect(() => drawOps(pdf, parseSheetSvg(page))).not.toThrow();
    }
  });
});
