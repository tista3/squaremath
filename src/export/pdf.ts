// OWNER: render-export agent. Draws sheet SVGs into a jsPDF document as vectors (sharp at any zoom,
// small files, selectable text).
//
// Only the SVG subset that render/sheet emits is supported: <g>, <rect>, <path> (absolute M L H V Z) and
// <text> with <tspan> runs, plain hex colours, sizes in mm. Text uses the PDF's built-in Helvetica, which
// only covers the WinAnsi character set; parseSheetSvg throws UnsupportedSvgError for anything else (e.g. a
// colour name in Cyrillic) so the caller can fall back to a raster image for that page.
import type { jsPDF } from 'jspdf';
import { advanceWidth } from '../render/textMetrics';

export class UnsupportedSvgError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnsupportedSvgError';
  }
}

interface Paint {
  fill: string | null;
  stroke: string | null;
  strokeWidth: number;
  lineCap: 'butt' | 'round';
  lineJoin: 'miter' | 'round';
}

interface Style extends Paint {
  fontSize: number;
  bold: boolean;
  anchor: 'start' | 'middle' | 'end';
}

export interface TextRun {
  text: string;
  bold: boolean;
}

/** Runs drawn one after another from (x, y), aligned as a whole by `anchor`. */
export interface TextChunk {
  x: number;
  y: number;
  runs: TextRun[];
}

export type DrawOp =
  | ({ kind: 'rect'; x: number; y: number; w: number; h: number; rx: number } & Paint)
  | ({ kind: 'path'; subpaths: { points: [number, number][]; closed: boolean }[] } & Paint)
  | { kind: 'text'; fill: string; fontSize: number; anchor: Style['anchor']; chunks: TextChunk[] };

const MM_TO_PT = 72 / 25.4;

/** Unicode code points (beyond Latin-1) that the PDF's WinAnsiEncoding can show. */
const WIN_ANSI_EXTRA = new Set([
  0x152, 0x153, 0x160, 0x161, 0x178, 0x17d, 0x17e, 0x192, 0x2c6, 0x2dc, 0x2013, 0x2014, 0x2018, 0x2019, 0x201a,
  0x201c, 0x201d, 0x201e, 0x2020, 0x2021, 0x2022, 0x2026, 0x2030, 0x2039, 0x203a, 0x20ac, 0x2122,
]);

/** Glyphs Helvetica lacks, replaced by a close equivalent. */
const SUBSTITUTES: Record<string, string> = { '−': '–' };

function isWinAnsi(ch: string): boolean {
  const cp = ch.codePointAt(0) ?? 0;
  return (cp >= 0x20 && cp <= 0x7e) || (cp >= 0xa0 && cp <= 0xff) || WIN_ANSI_EXTRA.has(cp);
}

/** Text as the PDF font can show it; throws when a character has no WinAnsi equivalent. */
export function pdfText(text: string): string {
  const out = [...text].map((ch) => SUBSTITUTES[ch] ?? ch).join('');
  for (const ch of out) {
    if (!isWinAnsi(ch)) throw new UnsupportedSvgError(`Character U+${ch.codePointAt(0)?.toString(16)} not in WinAnsi`);
  }
  return out;
}

function color(value: string | null): string | null {
  if (value === null || value === 'none') return null;
  const v = value.trim().toLowerCase();
  if (/^#[0-9a-f]{6}$/.test(v)) return v;
  if (/^#[0-9a-f]{3}$/.test(v)) return `#${[...v.slice(1)].map((c) => c + c).join('')}`;
  throw new UnsupportedSvgError(`Unsupported colour "${value}"`);
}

function num(el: Element, name: string, fallback = 0): number {
  const raw = el.getAttribute(name);
  if (raw === null) return fallback;
  const v = Number(raw);
  if (!Number.isFinite(v)) throw new UnsupportedSvgError(`Bad number ${name}="${raw}"`);
  return v;
}

function inherit(el: Element, parent: Style): Style {
  const attr = (name: string) => el.getAttribute(name);
  const fill = attr('fill');
  const stroke = attr('stroke');
  const weight = attr('font-weight');
  const anchor = attr('text-anchor');
  if (attr('opacity') ?? attr('fill-opacity') ?? attr('stroke-opacity') ?? attr('transform')) {
    throw new UnsupportedSvgError('Opacity and transforms are not supported');
  }
  if (anchor !== null && anchor !== 'start' && anchor !== 'middle' && anchor !== 'end') {
    throw new UnsupportedSvgError(`Unsupported text-anchor "${anchor}"`);
  }
  return {
    fill: fill === null ? parent.fill : color(fill),
    stroke: stroke === null ? parent.stroke : color(stroke),
    strokeWidth: num(el, 'stroke-width', parent.strokeWidth),
    lineCap: attr('stroke-linecap') === 'round' ? 'round' : attr('stroke-linecap') === null ? parent.lineCap : 'butt',
    lineJoin: attr('stroke-linejoin') === 'round' ? 'round' : attr('stroke-linejoin') === null ? parent.lineJoin : 'miter',
    fontSize: num(el, 'font-size', parent.fontSize),
    bold: weight === null ? parent.bold : weight === 'bold' || Number(weight) >= 600,
    anchor: anchor ?? parent.anchor,
  };
}

function paint(style: Style): Paint {
  const { fill, stroke, strokeWidth, lineCap, lineJoin } = style;
  return { fill, stroke, strokeWidth, lineCap, lineJoin };
}

/** Absolute M/L/H/V/Z path data → polylines. */
export function parsePathData(d: string): { points: [number, number][]; closed: boolean }[] {
  const tokens = d.match(/[A-Za-z]|-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/g) ?? [];
  const subpaths: { points: [number, number][]; closed: boolean }[] = [];
  let current: { points: [number, number][]; closed: boolean } | null = null;
  let x = 0;
  let y = 0;
  let i = 0;
  const next = () => {
    const v = Number(tokens[i++]);
    if (!Number.isFinite(v)) throw new UnsupportedSvgError(`Bad path data "${d}"`);
    return v;
  };
  let cmd = '';
  while (i < tokens.length) {
    if (/[A-Za-z]/.test(tokens[i])) cmd = tokens[i++];
    switch (cmd) {
      case 'M':
        x = next();
        y = next();
        current = { points: [[x, y]], closed: false };
        subpaths.push(current);
        cmd = 'L'; // further pairs are implicit line-tos
        break;
      case 'L':
      case 'H':
      case 'V':
        if (!current) throw new UnsupportedSvgError('Path must start with M');
        if (cmd !== 'V') x = next();
        if (cmd === 'L') y = next();
        else if (cmd === 'V') y = next();
        current.points.push([x, y]);
        break;
      case 'Z':
        if (current) current.closed = true;
        cmd = '';
        break;
      default:
        throw new UnsupportedSvgError(`Unsupported path command "${cmd}"`);
    }
  }
  return subpaths;
}

/** SVG collapses runs of white space into one space and drops it at the start of a <text>. */
function textRuns(text: Element, style: Style): TextChunk[] {
  const chunks: TextChunk[] = [{ x: num(text, 'x'), y: num(text, 'y'), runs: [] }];
  let y = chunks[0].y;
  let atStart = true;
  const addRun = (raw: string, bold: boolean) => {
    let s = raw.replace(/\s+/g, ' ');
    if (atStart) s = s.replace(/^ /, '');
    if (!s) return;
    atStart = false;
    chunks[chunks.length - 1].runs.push({ text: pdfText(s), bold });
  };
  for (const node of [...text.childNodes]) {
    if (node.nodeType === 3) {
      addRun(node.textContent ?? '', style.bold);
      continue;
    }
    if (node.nodeType !== 1) continue;
    const el = node as Element;
    if (el.localName !== 'tspan' || el.children.length > 0) throw new UnsupportedSvgError('Only flat <tspan> is supported');
    const tspanStyle = inherit(el, style);
    if (tspanStyle.fontSize !== style.fontSize || tspanStyle.fill !== style.fill) {
      throw new UnsupportedSvgError('Font size and colour must be set on <text>');
    }
    if (el.hasAttribute('x') || el.hasAttribute('y') || el.hasAttribute('dy')) {
      y = el.hasAttribute('y') ? num(el, 'y') : y + num(el, 'dy');
      chunks.push({ x: el.hasAttribute('x') ? num(el, 'x') : chunks[chunks.length - 1].x, y, runs: [] });
    }
    addRun(el.textContent ?? '', tspanStyle.bold);
  }
  return chunks.filter((c) => c.runs.length > 0);
}

function walk(el: Element, style: Style, ops: DrawOp[]): void {
  const s = inherit(el, style);
  switch (el.localName) {
    case 'svg':
    case 'g':
      for (const child of el.children) walk(child, s, ops);
      return;
    case 'rect':
      ops.push({ kind: 'rect', x: num(el, 'x'), y: num(el, 'y'), w: num(el, 'width'), h: num(el, 'height'), rx: num(el, 'rx'), ...paint(s) });
      return;
    case 'path':
      ops.push({ kind: 'path', subpaths: parsePathData(el.getAttribute('d') ?? ''), ...paint(s) });
      return;
    case 'text': {
      const chunks = textRuns(el, s);
      if (chunks.length > 0) ops.push({ kind: 'text', fill: s.fill ?? '#000000', fontSize: s.fontSize, anchor: s.anchor, chunks });
      return;
    }
    default:
      throw new UnsupportedSvgError(`Unsupported element <${el.localName}>`);
  }
}

/**
 * Parses a sheet SVG (mm units, viewBox starting at 0 0) into draw operations. Throws UnsupportedSvgError
 * when the page needs something the vector path cannot draw.
 */
export function parseSheetSvg(svg: string): DrawOp[] {
  const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
  const root = doc.documentElement;
  if (root.localName !== 'svg' || doc.getElementsByTagName('parsererror').length > 0) {
    throw new UnsupportedSvgError('Not a well-formed SVG');
  }
  const viewBox = (root.getAttribute('viewBox') ?? '').trim().split(/[\s,]+/).map(Number);
  if (viewBox[0] !== 0 || viewBox[1] !== 0 || !/mm$/.test(root.getAttribute('width') ?? '')) {
    throw new UnsupportedSvgError('Sheet SVG must be in mm with a viewBox at 0 0');
  }
  const ops: DrawOp[] = [];
  const base: Style = { fill: '#000000', stroke: null, strokeWidth: 1, lineCap: 'butt', lineJoin: 'miter', fontSize: 4, bold: false, anchor: 'start' };
  walk(root, base, ops);
  return ops;
}

function applyPaint(doc: jsPDF, p: Paint): 'F' | 'S' | 'FD' | null {
  if (p.fill) doc.setFillColor(p.fill);
  if (p.stroke) {
    doc.setDrawColor(p.stroke);
    doc.setLineWidth(p.strokeWidth);
    doc.setLineCap(p.lineCap);
    doc.setLineJoin(p.lineJoin);
  }
  if (p.fill && p.stroke) return 'FD';
  if (p.fill) return 'F';
  return p.stroke ? 'S' : null;
}

function drawText(doc: jsPDF, op: Extract<DrawOp, { kind: 'text' }>): void {
  doc.setFontSize(op.fontSize * MM_TO_PT);
  doc.setTextColor(op.fill);
  for (const chunk of op.chunks) {
    const width = chunk.runs.reduce((sum, r) => sum + advanceWidth(r.text, op.fontSize, r.bold), 0);
    let x = op.anchor === 'middle' ? chunk.x - width / 2 : op.anchor === 'end' ? chunk.x - width : chunk.x;
    for (const run of chunk.runs) {
      doc.setFont('helvetica', run.bold ? 'bold' : 'normal');
      doc.text(run.text, x, chunk.y, { baseline: 'alphabetic' });
      x += advanceWidth(run.text, op.fontSize, run.bold);
    }
  }
}

/** Draws parsed operations onto the current page of `doc` (unit: mm). */
export function drawOps(doc: jsPDF, ops: DrawOp[]): void {
  for (const op of ops) {
    if (op.kind === 'text') {
      drawText(doc, op);
      continue;
    }
    const style = applyPaint(doc, op);
    if (!style) continue;
    if (op.kind === 'rect') {
      if (op.rx > 0) doc.roundedRect(op.x, op.y, op.w, op.h, op.rx, op.rx, style);
      else doc.rect(op.x, op.y, op.w, op.h, style);
      continue;
    }
    for (const sub of op.subpaths) {
      sub.points.forEach(([x, y], i) => (i === 0 ? doc.moveTo(x, y) : doc.lineTo(x, y)));
      if (sub.closed) doc.close();
    }
    if (style === 'FD') doc.fillStroke();
    else if (style === 'F') doc.fill();
    else doc.stroke();
  }
}
