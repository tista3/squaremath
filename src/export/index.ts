// OWNER: render-export agent. Downloads & printing.
// Puzzle functions reject with an Error if the puzzle cannot be generated.
import type { Design, PuzzleError } from '../core/types';
import { generatePuzzle } from '../core/puzzle';
import { escapeXml, pageSizeMm, renderDesignSVG, renderSheetPages, type OkPuzzle } from '../render/sheet';
import { drawOps, parseSheetSvg, UnsupportedSvgError } from './pdf';

/** Resolution of the sheet PNG, and of PDF pages that cannot be drawn as vectors. */
const PNG_DPI = 200;
const PDF_RASTER_DPI = 300;
/** Longest side of the exported picture is at least this many pixels. */
const PICTURE_TARGET_PX = 1200;
const PICTURE_MIN_CELL_PX = 32;
/** Stays below the smallest common canvas limit (iOS Safari: 16.7 megapixels). */
const MAX_CANVAS_PIXELS = 16_000_000;
/** Gap between stacked pages in a multi-page PNG, as a fraction of the page width. */
const PNG_PAGE_GAP = 0.03;
const PNG_GAP_COLOR = '#d0d0d0';
const MM_PER_INCH = 25.4;
/** Fallback for browsers that never fire 'afterprint' on the print frame. */
const PRINT_CLEANUP_MS = 10 * 60 * 1000;

/** Thrown when a puzzle cannot be generated; `error.code` lets the UI show a translated message. */
export class PuzzleGenerationError extends Error {
  readonly error: PuzzleError;
  constructor(error: PuzzleError) {
    super(
      error.code === 'tooManyColors'
        ? `Too many colours (${error.colorsUsed}) for the chosen numbers (${error.resultsAvailable} results available)`
        : error.code === 'tooFewSymbols'
          ? `Too many colours (${error.colorsUsed}) for the symbol set (${error.symbolsAvailable} symbols)`
          : 'No operation selected',
    );
    this.name = 'PuzzleGenerationError';
    this.error = error;
  }
}

function requirePuzzle(design: Design): OkPuzzle {
  const puzzle = generatePuzzle(design);
  if (!puzzle.ok) throw new PuzzleGenerationError(puzzle.error);
  return puzzle;
}

/** Puzzle page SVGs (several when a big grid is split), plus the solution page when print.includeSolution. */
export function sheetPages(design: Design): string[] {
  const puzzle = requirePuzzle(design);
  const pages = renderSheetPages(design, puzzle, 'puzzle');
  return design.print.includeSolution ? [...pages, ...renderSheetPages(design, puzzle, 'solution')] : pages;
}

function pageWidthPx(design: Design, dpi: number): number {
  return Math.round((pageSizeMm(design).w / MM_PER_INCH) * dpi);
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Safari starts the download asynchronously; revoking immediately can cancel it.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * File-system-safe base name from a design name (keeps unicode letters, max ~50 chars, fallback "squaremath").
 * Characters that are not allowed in file names become "-" so "12:30" stays readable as "12-30".
 */
export function safeFileName(name: string): string {
  const trimEdges = (s: string) => s.replace(/^[\s.-]+|[\s.-]+$/g, '');
  const cleaned = trimEdges(
    name
      .normalize('NFC')
      .replace(/\s+/g, ' ')
      .replace(/[\\/:*?"<>|\p{Cc}]+/gu, '-')
      .replace(/-{2,}/g, '-'),
  );
  const short = trimEdges([...cleaned].slice(0, 50).join(''));
  return short || 'squaremath';
}

/** Aspect ratio from the SVG viewBox (more reliable than naturalWidth for mm-sized SVGs in Firefox). */
function svgAspect(svg: string, img?: HTMLImageElement): number {
  const m = /viewBox="\s*[-\d.]+[\s,]+[-\d.]+[\s,]+([\d.]+)[\s,]+([\d.]+)\s*"/.exec(svg);
  if (m && Number(m[1]) > 0) return Number(m[2]) / Number(m[1]);
  return img && img.naturalWidth > 0 ? img.naturalHeight / img.naturalWidth : 1;
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Could not load SVG image'));
    img.src = url;
  });
}

function canvasToPng(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('Could not encode PNG'))), 'image/png');
  });
}

function newCanvas(width: number, height: number): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width));
  canvas.height = Math.max(1, Math.round(height));
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D context unavailable');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  return { canvas, ctx };
}

/** Draws an SVG string at (0, y) scaled to `widthPx` (white background). */
async function drawSvg(ctx: CanvasRenderingContext2D, svg: string, y: number, widthPx: number): Promise<void> {
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }));
  try {
    const img = await loadImage(url);
    ctx.drawImage(img, 0, y, widthPx, widthPx * svgAspect(svg, img));
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Rasterise an SVG string to PNG at the given pixel width (white background). */
export async function svgToPngBlob(svg: string, widthPx: number): Promise<Blob> {
  const { canvas, ctx } = newCanvas(widthPx, widthPx * svgAspect(svg));
  await drawSvg(ctx, svg, 0, canvas.width);
  return canvasToPng(canvas);
}

/**
 * Pixel width for `count` pages stacked with gaps: `widthPx`, reduced if needed so the whole image stays
 * within MAX_CANVAS_PIXELS.
 */
export function stackedWidthPx(widthPx: number, aspect: number, count: number): number {
  const heightPerWidth = count * aspect + (count - 1) * PNG_PAGE_GAP;
  return Math.min(widthPx, Math.floor(Math.sqrt(MAX_CANVAS_PIXELS / heightPerWidth)));
}

/** All pages (same size) stacked top to bottom in one PNG, separated by a grey band. */
async function stackedPng(svgs: string[], widthPx: number): Promise<Blob> {
  const aspect = svgAspect(svgs[0]);
  const w = stackedWidthPx(widthPx, aspect, svgs.length);
  const pageH = Math.round(w * aspect);
  const gap = Math.round(w * PNG_PAGE_GAP);
  const { canvas, ctx } = newCanvas(w, svgs.length * pageH + (svgs.length - 1) * gap);
  ctx.fillStyle = PNG_GAP_COLOR;
  for (let i = 1; i < svgs.length; i++) ctx.fillRect(0, i * (pageH + gap) - gap, w, gap);
  for (const [i, svg] of svgs.entries()) await drawSvg(ctx, svg, i * (pageH + gap), w);
  return canvasToPng(canvas);
}

/**
 * PDF (jsPDF): the puzzle pages (+ solution page if print.includeSolution), drawn as vectors with the
 * built-in Helvetica. A page whose text the PDF font cannot show (e.g. non-Latin colour names) is embedded
 * as a 300-dpi image instead.
 */
export async function downloadPuzzlePdf(design: Design): Promise<void> {
  const pages = sheetPages(design);
  const { w, h } = pageSizeMm(design);
  const orientation = w > h ? 'landscape' : 'portrait';
  const format = design.print.paper === 'Letter' ? 'letter' : 'a4';
  const { jsPDF } = await import('jspdf');
  const doc = new jsPDF({ orientation, unit: 'mm', format, compress: true });
  for (const [i, svg] of pages.entries()) {
    if (i > 0) doc.addPage(format, orientation);
    try {
      drawOps(doc, parseSheetSvg(svg));
    } catch (err) {
      if (!(err instanceof UnsupportedSvgError)) throw err;
      const png = await svgToPngBlob(svg, pageWidthPx(design, PDF_RASTER_DPI));
      doc.addImage(new Uint8Array(await png.arrayBuffer()), 'PNG', 0, 0, w, h, undefined, 'FAST');
    }
  }
  downloadBlob(doc.output('blob'), `${safeFileName(design.name)}.pdf`);
}

/**
 * One PNG of the sheet. Several pages (a split puzzle, or puzzle + solution) are stacked in the same image:
 * browsers block or ask about a second download started by one click.
 */
export async function downloadPuzzlePng(design: Design): Promise<void> {
  const pages = sheetPages(design);
  const png = await stackedPng(pages, pageWidthPx(design, PNG_DPI));
  downloadBlob(png, `${safeFileName(design.name)}-puzzle.png`);
}

/** Pixels per square for the picture PNG: the longest side gets at least PICTURE_TARGET_PX. */
export function pictureCellPx(design: Pick<Design, 'width' | 'height'>): number {
  return Math.max(PICTURE_MIN_CELL_PX, Math.ceil(PICTURE_TARGET_PX / Math.max(design.width, design.height)));
}

/** PNG of the coloured picture, with a white margin and a thin outline. */
export async function downloadDesignPng(design: Design): Promise<void> {
  const cellPx = pictureCellPx(design);
  const svg = renderDesignSVG(design, { cellPx, frame: true });
  const png = await svgToPngBlob(svg, (design.width + 2) * cellPx);
  downloadBlob(png, `${safeFileName(design.name)}.png`);
}

function printHtml(design: Design, svgs: string[]): string {
  const { w, h } = pageSizeMm(design);
  const size = `${design.print.paper === 'Letter' ? 'letter' : 'A4'} ${w > h ? 'landscape' : 'portrait'}`;
  // Pages are 1 mm shorter than the paper so rounding never spills onto an extra blank sheet.
  const css =
    `@page{size:${size};margin:0}html,body{margin:0;padding:0;background:#fff}` +
    `.page{width:${w}mm;height:${h - 1}mm;overflow:hidden;page-break-after:always;break-after:page}` +
    `.page:last-child{page-break-after:auto;break-after:auto}.page svg{display:block;width:${w}mm;height:${h}mm}`;
  const pages = svgs.map((svg) => `<div class="page">${svg}</div>`).join('');
  return (
    `<!doctype html><html><head><meta charset="utf-8"><title>${escapeXml(design.name)}</title>` +
    `<style>${css}</style></head><body>${pages}</body></html>`
  );
}

/** iOS WebKit prints the parent page instead of an iframe's content. */
function isIOS(): boolean {
  return /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

/** The browser refused to open the print window (pop-up blocker). */
export class PopupBlockedError extends Error {
  readonly code = 'popupBlocked';
  constructor() {
    super('Popup blocked: allow popups to print');
    this.name = 'PopupBlockedError';
  }
}

function printInNewWindow(html: string): void {
  const win = window.open('', '_blank');
  if (!win) throw new PopupBlockedError();
  win.document.open();
  win.document.write(html);
  win.document.close();
  const run = () => {
    win.focus();
    win.print();
  };
  if (win.document.readyState === 'complete') setTimeout(run, 100);
  else win.addEventListener('load', run, { once: true });
}

function printInIframe(html: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const iframe = document.createElement('iframe');
    iframe.setAttribute('aria-hidden', 'true');
    iframe.tabIndex = -1;
    // Not display:none — some browsers refuse to print hidden frames.
    iframe.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;opacity:0;pointer-events:none';
    let timer = 0;
    const cleanup = () => {
      clearTimeout(timer);
      iframe.remove();
    };
    iframe.onload = () => {
      const win = iframe.contentWindow;
      if (!win) {
        cleanup();
        reject(new Error('Print frame unavailable'));
        return;
      }
      win.addEventListener('afterprint', cleanup, { once: true });
      timer = window.setTimeout(cleanup, PRINT_CLEANUP_MS);
      try {
        win.focus();
        win.print();
        resolve();
      } catch (e) {
        cleanup();
        reject(e instanceof Error ? e : new Error(String(e)));
      }
    };
    iframe.srcdoc = html;
    document.body.appendChild(iframe);
  });
}

/** Print puzzle (+ solution) via a hidden iframe with @page size set; vector SVG pages. */
export async function printPuzzle(design: Design): Promise<void> {
  // Everything before window.open stays synchronous so the popup still counts as a user gesture.
  const html = printHtml(design, sheetPages(design));
  if (isIOS()) printInNewWindow(html);
  else await printInIframe(html);
}
