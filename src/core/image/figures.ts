// OWNER: image-core agent. Finds the separate drawings on a sheet (character sheet, sticker page, clip-art set).
//
// 1. Ink = whatever is not paper. A piece = a connected blob of ink together with the paper it encloses.
// 2. Frames (cards round each drawing) are peeled off, so that what is inside counts by itself.
// 3. Writing = pieces of one ink colour that line up into words and are small next to the drawings (or
//    tightly set, for titles). Where a caption runs into a drawing's feet, the caption's part is erased:
//    only pixels of the ink colour, only in the band of that line of writing.
// 4. Big pieces are figures; pieces with strongly overlapping boxes are one figure; small pieces (a floating
//    hand, sparks, puffs of smoke) join the figure next to them.
// Everything is linear in the number of pixels, apart from a little pairing of the pieces.
import { ALPHA_OPAQUE } from './analyze';
import type { CropBox, RgbaImage } from './types';

export interface Figure {
  /** Where the figure is, in the pixels of the image given to findFigures (with a little margin). */
  box: CropBox;
  /** box.w × box.h, 1 = belongs to this figure; 0 = paper, a neighbour or writing. */
  keep: Uint8Array;
}

export interface FigureSheet {
  width: number;
  height: number;
  /** The paper colour (RGBA; alpha 0 for a transparent sheet). */
  paper: [number, number, number, number];
  /** In reading order. */
  figures: Figure[];
}

/** A pixel is ink from this channel difference to the paper. */
const INK_DIFFERENCE = 14;
/** Paler than that is still ink where it is a fill: this far from the paper, all over a 5 × 5 window. */
const PALE_DIFFERENCE = 6;
/** Share of the border that has to be paper, and how far (channel difference) it may stray. */
const PAPER_SHARE = 0.55;
const PAPER_SPREAD = 14;
/** More pieces than this is texture or noise, not a sheet. */
const MAX_PIECES = 20000;
/** Pieces with fewer pixels are specks. */
const SPECK = 6;
/** Writing: share of pixels on the blend from paper to one ink, and how far off that blend they may be. */
const ONE_INK_SHARE = 0.9;
const BLEND_TOLERANCE = 30;
/** Where a caption touches a drawing, JPEG smears its colour this far. */
const SMEARED_TOLERANCE = 46;
/** Writing stands out from the paper this much (RGB distance; JPEG specks don't). */
const WRITING_CONTRAST = 90;
/** Same ink: RGB distance. */
const SAME_INK = 90;
/** Letters of one word or line: gap and height ratio, relative to their height. */
const WORD_GAP = 0.45;
const TIGHT_GAP = 0.32;
/** The strokes of writing are at most this thick, relative to its height… */
const STROKE_THICKNESS = 0.24;
const LETTER_HEIGHT_RATIO = 3.5;
/** …and big letters are evenly inked inside: this share of the inner pixels is the ink (grey drawings are shaded). */
const EVEN_INK_SHARE = 0.7;
const EVEN_INK = 60;
/**
 * …and simple: the median piece's line is at most this long, relative to its size, and it is narrower than
 * wide (line art in a row is evenly inked and thin too, but a drawing is a lot more line than a letter).
 */
const LETTER_LINE_LENGTH = 5;
const LETTER_ASPECT = 0.95;
/**
 * A page of one ink (line art) where this share of the ink can be writing: there a drawing's own strokes pass
 * for words, so captions need letters, or the dense line of a word whose letters touch.
 */
const LINE_ART_SHARE = 0.8;
const WORD_LINE_LENGTH = 3.2;
/** A caption is at most this tall, relative to a typical drawing. */
const CAPTION_HEIGHT = 0.38;
/** Where the ink's colour is thicker than a stroke (radius relative to the line's height) it is a fill. */
const FILL_RADIUS = 0.12;
/** Inside a drawing's box, within this much of its height from top and bottom, is not its caption (a nose). */
const FACE_BAND = 0.16;
/** A caption can run into this much of a drawing's height, and no further… */
const CAPTION_REACH = 0.45;
/** …and only under the drawings along its line (their size beyond the line's ends, for a fused last word). */
const LINE_OVERHANG = 1.3;
/**
 * A page of writing (a screenshot of text): this share of it is one-ink, and its would-be figures are as simple
 * as letters (line length relative to size) and either as small as type (px) or as tall as its letters.
 */
const PAGE_OF_INK_SHARE = 0.9;
const LETTER_SIMPLICITY = 4.1;
const TYPE_PX = 56;
const LETTER_TALL = 1.8;
/** A figure is at least this big and this thick, relative to a typical drawing. */
const FIGURE_SIZE = 0.42;
const FIGURE_THICKNESS = 0.14;
/** Fewer image pixels than this across is not worth picking. */
const MIN_FIGURE_PX = 16;
/** Boxes overlapping by this share of the smaller one are parts of one figure. */
const SAME_FIGURE_OVERLAP = 0.3;
/**
 * Line art is drawn with open strokes: its pieces are one figure up to this gap (relative to a typical drawing),
 * when they lie side by side or one over the other for this share of the smaller one.
 */
const BROKEN_LINE_GAP = 0.09;
const BROKEN_LINE_ALONG = 0.5;
/** A small piece joins a figure this close (relative to a typical drawing). */
const FRAGMENT_GAP = 0.18;
/** With only two figures: the smaller is at least this share of the bigger, and they are this far apart. */
const PAIR_SIZE = 0.6;
const PAIR_GAP = 0.06;

type Rgb = [number, number, number];

interface Piece {
  id: number;
  x0: number;
  y0: number;
  /** Exclusive. */
  x1: number;
  y1: number;
  /** Pixels, enclosed paper included. */
  area: number;
  /** The ink colour (mean of the pixels furthest from the paper). */
  ink: Rgb;
  oneInk: boolean;
  /** oneInk, and dark (or bright) enough to be writing. */
  canBeWriting: boolean;
  /** Mean thickness of its ink, in pixels. */
  stroke: number;
  /** Length of its strokes, in pixels. */
  lineLength: number;
  /** Inner pixels (ink all round) are all the ink colour. */
  evenInk: boolean;
}

/** A line of writing. */
interface TextLine {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  ink: Rgb;
}

interface Bounds {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

interface Page {
  w: number;
  h: number;
  /** Colour composited over the paper, 3 bytes per pixel. */
  rgb: Uint8Array;
  paper: Rgb;
  ink: Uint8Array;
  /** Piece id per pixel, 0 = open paper. */
  label: Int32Array;
  queue: Int32Array;
}

export function findFigures(image: RgbaImage): FigureSheet | null {
  const { width: w, height: h } = image;
  if (w < MIN_FIGURE_PX || h < MIN_FIGURE_PX || image.data.length < w * h * 4) return null;
  const found = findPaper(image);
  if (!found) return null;
  const page = makePage(image, found);

  let pieces = findPieces(page);
  // (A single piece may still be a frame round the whole sheet.)
  if (!pieces?.length) return null;
  for (let round = 0; round < 2; round++) {
    if (!peelFrames(page, pieces)) break;
    const next = findPieces(page);
    if (!next) return null;
    pieces = next;
  }
  if (pieces.length < 2) return null;

  let lines = textLines(findWriting(pieces));
  if (lines.length && eraseTouchingText(page, pieces, lines)) {
    const next = findPieces(page);
    if (!next) return null;
    pieces = next;
    // The words that were stuck to drawings stand alone now.
    lines = [...lines, ...textLines(findWriting(pieces))];
  }
  const writing = new Set(findWriting(pieces).flat());
  const drawn = pieces.filter((p) => !writing.has(p) && !isTextCrumb(p, lines));
  const groups = groupFigures(drawn);
  if (!groups || isPageOfWriting(pieces, writing, groups)) return null;

  return {
    width: w,
    height: h,
    paper: found.clear ? [255, 255, 255, 0] : [...page.paper, 255],
    figures: readingOrder(groups).map((group) => toFigure(page, group)),
  };
}

// ---------------------------------------------------------------------------------------------
// Paper and ink

function findPaper(image: RgbaImage): { rgb: Rgb; clear: boolean } | null {
  const { width: w, height: h, data } = image;
  const ring: number[] = [];
  for (let x = 0; x < w; x++) ring.push(x, (h - 1) * w + x);
  for (let y = 1; y < h - 1; y++) ring.push(y * w, y * w + w - 1);
  const solid = ring.filter((i) => data[i * 4 + 3] >= ALPHA_OPAQUE);
  if (ring.length - solid.length >= ring.length * PAPER_SHARE) return { rgb: [255, 255, 255], clear: true };
  if (solid.length === 0) return null;

  // The most common border colour, then the mean of what is close to it.
  const bins = new Map<number, number>();
  let best = solid[0];
  let bestCount = 0;
  for (const i of solid) {
    const key = ((data[i * 4] >> 3) << 10) | ((data[i * 4 + 1] >> 3) << 5) | (data[i * 4 + 2] >> 3);
    const count = (bins.get(key) ?? 0) + 1;
    bins.set(key, count);
    if (count > bestCount) {
      bestCount = count;
      best = i;
    }
  }
  const sum = [0, 0, 0];
  let count = 0;
  for (const i of solid) {
    let far = 0;
    for (let c = 0; c < 3; c++) far = Math.max(far, Math.abs(data[i * 4 + c] - data[best * 4 + c]));
    if (far > PAPER_SPREAD) continue;
    for (let c = 0; c < 3; c++) sum[c] += data[i * 4 + c];
    count++;
  }
  if (count < ring.length * PAPER_SHARE) return null;
  return { rgb: [Math.round(sum[0] / count), Math.round(sum[1] / count), Math.round(sum[2] / count)], clear: false };
}

function makePage(image: RgbaImage, paper: { rgb: Rgb; clear: boolean }): Page {
  const { width: w, height: h, data } = image;
  const n = w * h;
  const rgb = new Uint8Array(n * 3);
  const ink = new Uint8Array(n);
  // 0 = paper, 1 = pale, 2 = ink; the pale that is a fill becomes ink below.
  const level = new Uint8Array(n);
  const [pr, pg, pb] = paper.rgb;
  for (let i = 0; i < n; i++) {
    const o = i * 4;
    const alpha = data[o + 3];
    let r = data[o], g = data[o + 1], b = data[o + 2];
    if (alpha < 255) {
      const f = alpha / 255;
      r = r * f + pr * (1 - f) + 0.5;
      g = g * f + pg * (1 - f) + 0.5;
      b = b * f + pb * (1 - f) + 0.5;
    }
    rgb[i * 3] = r;
    rgb[i * 3 + 1] = g;
    rgb[i * 3 + 2] = b;
    if (paper.clear) {
      // On a transparent sheet white is a colour like any other.
      if (alpha >= ALPHA_OPAQUE) ink[i] = 1;
    } else {
      const far = Math.max(Math.abs(r - pr), Math.abs(g - pg), Math.abs(b - pb));
      if (far > INK_DIFFERENCE) {
        ink[i] = 1;
        level[i] = 2;
      } else if (far > PALE_DIFFERENCE) {
        level[i] = 1;
      }
    }
  }
  if (!paper.clear) addPaleFills(level, ink, w, h);
  return { w, h, rgb, paper: paper.rgb, ink, label: new Int32Array(n), queue: new Int32Array(n) };
}

/** Pale areas at least 5 pixels thick (a white face, a belly) are ink; JPEG ringing is thinner and broken. */
function addPaleFills(level: Uint8Array, ink: Uint8Array, w: number, h: number): void {
  for (let y = 2; y < h - 2; y++) {
    for (let x = 2; x < w - 2; x++) {
      const i = y * w + x;
      if (level[i] !== 1 || !level[i - 1] || !level[i + 1] || !level[i - w] || !level[i + w]) continue;
      let solid = true;
      for (let dy = -2; dy <= 2 && solid; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
          if (!level[i + dy * w + dx]) {
            solid = false;
            break;
          }
        }
      }
      if (!solid) continue;
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) ink[i + dy * w + dx] = 1;
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Pieces

const distance = (a: Rgb, b: Rgb) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

/** Labels the page; null when it is too busy to be a sheet. */
function findPieces(page: Page): Piece[] | null {
  const { w, h, ink, label, queue } = page;
  const n = w * h;
  // −1 = open paper: reachable from the edge without crossing ink.
  label.fill(0);
  let tail = 0;
  const open = (i: number) => {
    if (label[i] || ink[i]) return;
    label[i] = -1;
    queue[tail++] = i;
  };
  for (let x = 0; x < w; x++) {
    open(x);
    open((h - 1) * w + x);
  }
  for (let y = 0; y < h; y++) {
    open(y * w);
    open(y * w + w - 1);
  }
  for (let head = 0; head < tail; head++) {
    // forEach4 by hand: this runs for nearly every pixel of the page, several times.
    const i = queue[head];
    const x = i % w;
    if (x > 0 && !label[i - 1] && !ink[i - 1]) (label[i - 1] = -1), (queue[tail++] = i - 1);
    if (x < w - 1 && !label[i + 1] && !ink[i + 1]) (label[i + 1] = -1), (queue[tail++] = i + 1);
    if (i >= w && !label[i - w] && !ink[i - w]) (label[i - w] = -1), (queue[tail++] = i - w);
    if (i < n - w && !label[i + w] && !ink[i + w]) (label[i + w] = -1), (queue[tail++] = i + w);
  }

  const pieces: Piece[] = [];
  let id = 0;
  for (let s = 0; s < n; s++) {
    if (label[s]) continue;
    if (++id > MAX_PIECES) return null;
    label[s] = id;
    queue[0] = s;
    let size = 1;
    let x0 = w, y0 = h, x1 = 0, y1 = 0;
    for (let head = 0; head < size; head++) {
      const i = queue[head];
      const x = i % w;
      const y = (i / w) | 0;
      if (x < x0) x0 = x;
      if (x >= x1) x1 = x + 1;
      if (y < y0) y0 = y;
      if (y >= y1) y1 = y + 1;
      const left = x > 0 ? i - 1 : i;
      const right = x < w - 1 ? i + 1 : i;
      const back = i - left;
      const ahead = right - i;
      const first = y > 0 ? i - w : i;
      const last = y < h - 1 ? i + w : i;
      for (let mid = first; mid <= last; mid += w) {
        for (let j = mid - back; j <= mid + ahead; j++) {
          if (label[j]) continue;
          label[j] = id;
          queue[size++] = j;
        }
      }
    }
    if (size < SPECK) continue;
    const pixels = queue.subarray(0, size);
    const found = inkOf(page, pixels);
    const canBeWriting = found.oneInk && distance(found.ink, page.paper) >= WRITING_CONTRAST;
    pieces.push({ id, x0, y0, x1, y1, area: size, ...strokeOf(page, pixels), canBeWriting, ...found });
  }
  for (let i = 0; i < n; i++) if (label[i] < 0) label[i] = 0;
  return pieces;
}

/** How far pixel i is from the blend of the paper and `ink`. */
function offBlend(page: Page, i: number, ink: Rgb): number {
  const { rgb, paper } = page;
  const ur = ink[0] - paper[0], ug = ink[1] - paper[1], ub = ink[2] - paper[2];
  const vr = rgb[i * 3] - paper[0], vg = rgb[i * 3 + 1] - paper[1], vb = rgb[i * 3 + 2] - paper[2];
  const length = ur * ur + ug * ug + ub * ub;
  const t = length ? Math.min(1.15, Math.max(0, (vr * ur + vg * ug + vb * ub) / length)) : 0;
  const er = vr - t * ur, eg = vg - t * ug, eb = vb - t * ub;
  return Math.sqrt(er * er + eg * eg + eb * eb);
}

/** Twice the ink's area over its perimeter is a stroke's thickness; half the perimeter is its length. */
function strokeOf(page: Page, pixels: Int32Array): { stroke: number; lineLength: number } {
  const { w, h, ink } = page;
  let area = 0;
  let edge = 0;
  for (const i of pixels) {
    if (!ink[i]) continue;
    area++;
    const x = i % w;
    if (x === 0 || x === w - 1 || i < w || i >= w * (h - 1) || !ink[i - 1] || !ink[i + 1] || !ink[i - w] || !ink[i + w]) edge++;
  }
  return { stroke: (2 * area) / Math.max(1, edge), lineLength: edge / 2 };
}

function inkOf(page: Page, pixels: Int32Array): { ink: Rgb; oneInk: boolean; evenInk: boolean } {
  const { w, h, rgb, paper } = page;
  // A sample is plenty for big pieces.
  const step = Math.max(1, Math.floor(pixels.length / 1500));
  const fromPaper = (i: number) =>
    Math.abs(rgb[i * 3] - paper[0]) + Math.abs(rgb[i * 3 + 1] - paper[1]) + Math.abs(rgb[i * 3 + 2] - paper[2]);
  let most = 0;
  for (let k = 0; k < pixels.length; k += step) most = Math.max(most, fromPaper(pixels[k]));
  let r = 0, g = 0, b = 0, count = 0;
  for (let k = 0; k < pixels.length; k += step) {
    const i = pixels[k];
    if (fromPaper(i) < most * 0.75) continue;
    r += rgb[i * 3];
    g += rgb[i * 3 + 1];
    b += rgb[i * 3 + 2];
    count++;
  }
  const ink: Rgb = [r / count, g / count, b / count];
  let on = 0;
  let all = 0;
  let inner = 0;
  let even = 0;
  for (let k = 0; k < pixels.length; k += step) {
    const i = pixels[k];
    all++;
    if (offBlend(page, i, ink) <= BLEND_TOLERANCE) on++;
    const x = i % w;
    if (x === 0 || x === w - 1 || i < w || i >= w * (h - 1) || !page.ink[i]) continue;
    if (!page.ink[i - 1] || !page.ink[i + 1] || !page.ink[i - w] || !page.ink[i + w]) continue;
    inner++;
    if (Math.hypot(rgb[i * 3] - ink[0], rgb[i * 3 + 1] - ink[1], rgb[i * 3 + 2] - ink[2]) <= EVEN_INK) even++;
  }
  return { ink, oneInk: on >= all * ONE_INK_SHARE, evenInk: even >= inner * EVEN_INK_SHARE };
}

// ---------------------------------------------------------------------------------------------
// Frames

const FRAME_FILL = 0.93;
const FRAME_SIDE = 0.85;
const FRAME_DEPTH = 4;
const FRAME_PAPER = 0.3;

/** Erases the lines of rectangular frames that have mostly paper inside; true when it did. */
function peelFrames(page: Page, pieces: Piece[]): boolean {
  const { w, ink, label } = page;
  let peeled = false;
  for (const p of pieces) {
    const pw = p.x1 - p.x0;
    const ph = p.y1 - p.y0;
    if (pw < MIN_FIGURE_PX || ph < MIN_FIGURE_PX || p.area < pw * ph * FRAME_FILL) continue;
    let paper = 0;
    for (let y = p.y0; y < p.y1; y++) {
      for (let x = p.x0; x < p.x1; x++) if (label[y * w + x] === p.id && !ink[y * w + x]) paper++;
    }
    if (paper < pw * ph * FRAME_PAPER) continue;

    // How thick is the line on each side (median depth to the paper inside)?
    const depths: number[] = [];
    let isFrame = true;
    for (let side = 0; side < 4 && isFrame; side++) {
      const along = side < 2 ? pw : ph;
      const across = side < 2 ? ph : pw;
      const at = (t: number, depth: number) =>
        side === 0 ? (p.y0 + depth) * w + p.x0 + t
        : side === 1 ? (p.y1 - 1 - depth) * w + p.x0 + t
        : side === 2 ? (p.y0 + t) * w + p.x0 + depth
        : (p.y0 + t) * w + p.x1 - 1 - depth;
      let covered = 0;
      const thickness: number[] = [];
      for (let t = 0; t < along; t++) {
        let depth = 0;
        while (depth < FRAME_DEPTH && !ink[at(t, depth)]) depth++;
        if (depth === FRAME_DEPTH) continue;
        covered++;
        while (depth < across / 6 && ink[at(t, depth)]) depth++;
        thickness.push(depth);
      }
      if (covered < along * FRAME_SIDE) {
        isFrame = false;
        break;
      }
      thickness.sort((a, b) => a - b);
      const depth = thickness[thickness.length >> 1];
      if (depth >= across / 8) isFrame = false; // a filled side, not a line
      depths.push(depth + 2);
    }
    if (!isFrame) continue;
    const [top, bottom, left, right] = depths;
    for (let y = p.y0; y < p.y1; y++) {
      for (let x = p.x0; x < p.x1; x++) {
        if (y < p.y0 + top || y >= p.y1 - bottom || x < p.x0 + left || x >= p.x1 - right) ink[y * w + x] = 0;
      }
    }
    peeled = true;
  }
  return peeled;
}

// ---------------------------------------------------------------------------------------------
// Writing

const widthOf = (b: Bounds) => b.x1 - b.x0;
const heightOf = (b: Bounds) => b.y1 - b.y0;
const sizeOf = (b: Bounds) => Math.sqrt(widthOf(b) * heightOf(b));

function median(values: number[]): number {
  return values.sort((a, b) => a - b)[values.length >> 1];
}

/** The size of a typical drawing: the median piece, by area, of those in several colours (else of all). */
function typicalSize(pieces: Piece[]): number {
  let pool = pieces.filter((p) => !p.oneInk && sizeOf(p) >= MIN_FIGURE_PX);
  if (pool.length < 2) pool = pieces.slice();
  pool.sort((a, b) => sizeOf(a) - sizeOf(b));
  let total = 0;
  for (const p of pool) total += p.area;
  let acc = 0;
  for (const p of pool) {
    acc += p.area;
    if (acc >= total / 2) return sizeOf(p);
  }
  return 0;
}

function boundsOf(parts: Bounds[]): Bounds {
  const out = { ...parts[0] };
  for (const p of parts) {
    out.x0 = Math.min(out.x0, p.x0);
    out.y0 = Math.min(out.y0, p.y0);
    out.x1 = Math.max(out.x1, p.x1);
    out.y1 = Math.max(out.y1, p.y1);
  }
  return { x0: out.x0, y0: out.y0, x1: out.x1, y1: out.y1 };
}

/** Groups of pieces that are words or lines of writing. */
function findWriting(pieces: Piece[]): Piece[][] {
  const typical = typicalSize(pieces);
  const letters = pieces.filter((p) => p.canBeWriting).sort((a, b) => a.x0 - b.x0);
  const parent = Array.from(letters.keys());
  const root = (i: number): number => {
    while (parent[i] !== i) i = parent[i] = parent[parent[i]];
    return i;
  };
  let tallest = 0;
  for (const p of letters) tallest = Math.max(tallest, heightOf(p));
  for (let i = 0; i < letters.length; i++) {
    const a = letters[i];
    for (let j = i + 1; j < letters.length; j++) {
      const b = letters[j];
      const gap = b.x0 - a.x1;
      if (gap > tallest * WORD_GAP) break; // sorted by x0: nothing further right is nearer
      const high = Math.max(heightOf(a), heightOf(b));
      const low = Math.min(heightOf(a), heightOf(b));
      if (gap > high * WORD_GAP || high > low * LETTER_HEIGHT_RATIO) continue;
      if (Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0) < low * 0.5) continue;
      if (distance(a.ink, b.ink) > SAME_INK) continue;
      parent[root(j)] = root(i);
    }
  }
  const groups = new Map<number, Piece[]>();
  letters.forEach((p, i) => {
    const r = root(i);
    const group = groups.get(r);
    if (group) group.push(p);
    else groups.set(r, [p]);
  });

  let totalArea = 0;
  let oneInkArea = 0;
  for (const p of pieces) {
    totalArea += p.area;
    if (p.canBeWriting && p.evenInk) oneInkArea += p.area;
  }
  const lineArt = oneInkArea >= totalArea * LINE_ART_SHARE;
  const writing: Piece[][] = [];
  for (const group of groups.values()) {
    const box = boundsOf(group);
    const w = widthOf(box);
    const h = heightOf(box);
    let caption = h <= typical * CAPTION_HEIGHT && w >= h * 1.5;
    if (caption && lineArt) {
      caption =
        group.length >= 3
          ? median(group.map((p) => widthOf(p) / heightOf(p))) <= 1.2
          : w >= h * 2 && group.some((p) => p.lineLength >= sizeOf(p) * WORD_LINE_LENGTH);
    }
    // A title can be as tall as the drawings, but its letters are set tight.
    let tight = group.length >= 3 && w >= h * 2 && group.every((p) => p.evenInk && p.stroke <= h * STROKE_THICKNESS);
    if (tight) {
      tight =
        median(group.map((p) => p.lineLength / sizeOf(p))) <= LETTER_LINE_LENGTH &&
        median(group.map((p) => widthOf(p) / heightOf(p))) <= LETTER_ASPECT;
    }
    if (tight) {
      let reach = group[0].x1;
      let wide = 0;
      let gaps = 0;
      for (let k = 1; k < group.length; k++) {
        const gap = group[k].x0 - reach;
        if (gap > h * TIGHT_GAP) wide++;
        gaps += Math.max(0, gap);
        reach = Math.max(reach, group[k].x1);
      }
      // Few wide gaps, or tight on average: monospaced type has a wide gap either side of every I and l.
      tight = wide <= group.length / 4 || gaps <= (group.length - 1) * h * TIGHT_GAP;
    }
    if ((caption || tight) && !isInsideDrawing(box, pieces)) writing.push(group);
  }
  return writing;
}

/** A face's nose and mouth look like a word, but sit inside the drawing. */
function isInsideDrawing(box: Bounds, pieces: Piece[]): boolean {
  const middle = (box.y0 + box.y1) / 2;
  return pieces.some((p) => {
    const h = heightOf(p);
    if (h < heightOf(box) * 2.2 || p.x0 > box.x0 || p.x1 < box.x1) return false;
    return middle > p.y0 + h * FACE_BAND && middle < p.y1 - h * FACE_BAND;
  });
}

/** Words on one baseline, merged into lines. */
function textLines(writing: Piece[][]): TextLine[] {
  const words = writing
    .map((group) => {
      let main = group[0];
      for (const p of group) if (p.area > main.area) main = p;
      return { ...boundsOf(group), ink: main.ink, letters: group.length };
    })
    .sort((a, b) => a.y0 + a.y1 - (b.y0 + b.y1));
  const rows: (TextLine & { letters: number })[][] = [];
  for (const word of words) {
    const row = rows.find((r) => {
      const h = Math.max(heightOf(r[0]), heightOf(word));
      return (
        Math.abs(r[0].y0 + r[0].y1 - word.y0 - word.y1) < h * 0.8 &&
        h < Math.min(heightOf(r[0]), heightOf(word)) * 1.8 &&
        distance(r[0].ink, word.ink) <= SAME_INK
      );
    });
    if (row) row.push(word);
    else rows.push([word]);
  }
  // A lone "word" of a piece or two is more likely a drawing's own detail (eyes, a mouth) than a line.
  const real = rows.filter((row) => row.length >= 2 || row[0].letters >= 4);
  return real.map((row) => {
    const tops = row.map((w) => w.y0).sort((a, b) => a - b);
    const bottoms = row.map((w) => w.y1).sort((a, b) => a - b);
    return {
      ...boundsOf(row),
      y0: tops[Math.floor(row.length * 0.1)],
      y1: bottoms[Math.min(row.length - 1, Math.floor(row.length * 0.9))],
      ink: row[0].ink,
    };
  });
}

/** Where a piece runs into a line of writing: erases the writing's part. True when it erased anything. */
function eraseTouchingText(page: Page, pieces: Piece[], lines: TextLine[]): boolean {
  const { w, ink, label } = page;
  let erased = false;
  const typical = typicalSize(pieces);
  for (const p of pieces) {
    for (const line of lines) {
      const h = heightOf(line);
      // Captions only: a title's band would slice through the drawings beside it.
      if (h > typical * CAPTION_HEIGHT || heightOf(p) < h * 1.6) continue;
      if (p.x0 > line.x1 + typical * LINE_OVERHANG || p.x1 < line.x0 - typical * LINE_OVERHANG) continue;
      const below = p.y1 > line.y0 + h * 0.4 && p.y1 <= line.y1 + h * 0.6 && p.y0 < line.y0;
      const above = p.y0 < line.y1 - h * 0.4 && p.y0 >= line.y0 - h * 0.6 && p.y1 > line.y1;
      if (!below && !above) continue;
      const top = Math.max(p.y0, below ? line.y0 - 1 : 0);
      const bottom = Math.min(p.y1, below ? p.y1 : line.y1 + 1);
      const bw = widthOf(p);
      const bh = bottom - top;
      if (bh > heightOf(p) * CAPTION_REACH) continue;
      // 1 = the writing's ink, 2 = another colour: the drawing.
      const kind = new Uint8Array(bw * bh);
      let all = 0;
      for (let y = 0; y < bh; y++) {
        for (let x = 0; x < bw; x++) {
          const i = (top + y) * w + p.x0 + x;
          if (label[i] !== p.id || !ink[i]) continue;
          all++;
          kind[y * bw + x] = offBlend(page, i, line.ink) <= SMEARED_TOLERANCE ? 1 : 2;
        }
      }
      markFills(kind, bw, bh, Math.max(2, Math.round(h * FILL_RADIUS)));
      const text: number[] = [];
      for (let y = 0; y < bh; y++) {
        for (let x = 0; x < bw; x++) {
          if (kind[y * bw + x] !== 1) continue;
          // An outline hugs the colour it goes round; letters don't.
          let byColour = false;
          for (let ny = Math.max(0, y - 1); ny <= Math.min(bh - 1, y + 1) && !byColour; ny++) {
            for (let nx = Math.max(0, x - 1); nx <= Math.min(bw - 1, x + 1); nx++) {
              if (kind[ny * bw + nx] === 2) {
                byColour = true;
                break;
              }
            }
          }
          if (!byColour) text.push((top + y) * w + p.x0 + x);
        }
      }
      if (text.length < h * h * 0.08 || text.length < all * 0.08) continue;
      for (const i of text) ink[i] = 0;
      erased = true;
    }
  }
  return erased;
}

/** Where `kind` is 1 all over a (2r+1)² window, the window is drawing (2), not strokes of writing. */
function markFills(kind: Uint8Array, w: number, h: number, r: number): void {
  const middles: number[] = [];
  for (let y = r; y < h - r; y++) {
    for (let x = r; x < w - r; x++) {
      if (kind[y * w + x] !== 1) continue;
      let solid = true;
      for (let dy = -r; dy <= r && solid; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (kind[(y + dy) * w + x + dx] !== 1) {
            solid = false;
            break;
          }
        }
      }
      if (solid) middles.push(y * w + x);
    }
  }
  for (const i of middles) for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) kind[i + dy * w + dx] = 2;
}

/** What is left of erased writing: a small piece of that ink, inside its line. */
function isTextCrumb(p: Piece, lines: TextLine[]): boolean {
  if (!p.canBeWriting) return false;
  const middle = (p.y0 + p.y1) / 2;
  return lines.some(
    (line) =>
      middle >= line.y0 - 2 && middle <= line.y1 + heightOf(line) * 0.3 &&
      heightOf(p) <= heightOf(line) * 1.3 && distance(p.ink, line.ink) <= SAME_INK,
  );
}

// ---------------------------------------------------------------------------------------------
// Figures

interface Group extends Bounds {
  pieces: Piece[];
}

/** The figures, or null when this is not a sheet of several. */
function groupFigures(pieces: Piece[]): Group[] | null {
  if (pieces.length < 2) return null;
  const rough = typicalSize(pieces);
  const sized = pieces.map(sizeOf).filter((s) => s >= rough * 0.35).sort((a, b) => a - b);
  if (sized.length === 0) return null;
  const typical = sized[sized.length >> 1];

  let groups: Group[] = [];
  const small: Piece[] = [];
  for (const p of pieces) {
    const thick = Math.min(widthOf(p), heightOf(p));
    const big = sizeOf(p) >= typical * FIGURE_SIZE && thick >= typical * FIGURE_THICKNESS && sizeOf(p) >= MIN_FIGURE_PX;
    if (big) groups.push({ x0: p.x0, y0: p.y0, x1: p.x1, y1: p.y1, pieces: [p] });
    else small.push(p);
  }

  for (let merged = true; merged; ) {
    merged = false;
    for (let i = 0; i < groups.length; i++) {
      for (let j = i + 1; j < groups.length; j++) {
        const a = groups[i];
        const b = groups[j];
        const ix = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0);
        const iy = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0);
        const overlapping =
          ix > 0 && iy > 0 && ix * iy >= SAME_FIGURE_OVERLAP * Math.min(widthOf(a) * heightOf(a), widthOf(b) * heightOf(b));
        if (!overlapping && !isBrokenLine(a, b, ix, iy, typical)) continue;
        groups[i] = { ...boundsOf([a, b]), pieces: [...a.pieces, ...b.pieces] };
        groups.splice(j, 1);
        merged = true;
        j = i; // the grown box may overlap earlier ones
      }
    }
  }
  if (groups.length < 2) return null;

  if (groups.length === 2) {
    const [a, b] = groups;
    const gap = Math.max(a.x0 - b.x1, b.x0 - a.x1, a.y0 - b.y1, b.y0 - a.y1);
    if (Math.min(sizeOf(a), sizeOf(b)) < Math.max(sizeOf(a), sizeOf(b)) * PAIR_SIZE || gap < typical * PAIR_GAP) return null;
  }

  const added: { group: number; piece: Piece }[] = [];
  for (const piece of small) {
    const cx = (piece.x0 + piece.x1) / 2;
    const cy = (piece.y0 + piece.y1) / 2;
    let best = -1;
    let bestScore = Infinity;
    groups.forEach((g, i) => {
      const gap = Math.hypot(Math.max(0, g.x0 - piece.x1, piece.x0 - g.x1), Math.max(0, g.y0 - piece.y1, piece.y0 - g.y1));
      if (gap > typical * FRAGMENT_GAP) return;
      // Inside several boxes: the one whose middle is nearest.
      const score = gap * 4 + Math.hypot((g.x0 + g.x1) / 2 - cx, (g.y0 + g.y1) / 2 - cy) / sizeOf(g);
      if (score < bestScore) {
        bestScore = score;
        best = i;
      }
    });
    if (best >= 0) added.push({ group: best, piece });
  }
  for (const { group, piece } of added) {
    const g = groups[group];
    groups[group] = { ...boundsOf([g, piece]), pieces: [...g.pieces, piece] };
  }
  return groups;
}

function isBrokenLine(a: Group, b: Group, ix: number, iy: number, typical: number): boolean {
  const gap = typical * BROKEN_LINE_GAP;
  const stacked = iy >= -gap && ix >= BROKEN_LINE_ALONG * Math.min(widthOf(a), widthOf(b));
  const beside = ix >= -gap && iy >= BROKEN_LINE_ALONG * Math.min(heightOf(a), heightOf(b));
  return (stacked || beside) && [...a.pieces, ...b.pieces].every((p) => p.canBeWriting && p.evenInk);
}

/** Whether the would-be figures are only words and letters that did not line up as writing. */
function isPageOfWriting(pieces: Piece[], writing: Set<Piece>, groups: Group[]): boolean {
  let total = 0;
  let inked = 0;
  for (const p of pieces) {
    total += p.area;
    if (p.canBeWriting) inked += p.area;
  }
  if (inked < total * PAGE_OF_INK_SHARE) return false;
  const simplicity = median(groups.map((g) => g.pieces.reduce((sum, p) => sum + p.lineLength, 0) / sizeOf(g)));
  if (simplicity >= LETTER_SIMPLICITY) return false;
  const height = median(groups.map(heightOf));
  return height < TYPE_PX || (writing.size > 0 && height <= median([...writing].map(heightOf)) * LETTER_TALL);
}

/** Rows top to bottom, each left to right. */
function readingOrder(groups: Group[]): Group[] {
  const middle = (g: Group) => (g.y0 + g.y1) / 2;
  const heights = groups.map(heightOf).sort((a, b) => a - b);
  const reach = heights[heights.length >> 1] / 2;
  const rows: Group[][] = [];
  for (const g of [...groups].sort((a, b) => middle(a) - middle(b))) {
    const row = rows[rows.length - 1];
    if (row && middle(g) - middle(row[0]) <= reach) row.push(g);
    else rows.push([g]);
  }
  return rows.flatMap((row) => row.sort((a, b) => a.x0 - b.x0));
}

/** The soft edge kept round a figure, in pixels. */
const KEEP_MARGIN = 2;

function toFigure(page: Page, group: Group): Figure {
  const { w, h, label } = page;
  const x = Math.max(0, group.x0 - KEEP_MARGIN);
  const y = Math.max(0, group.y0 - KEEP_MARGIN);
  const box = { x, y, w: Math.min(w, group.x1 + KEEP_MARGIN) - x, h: Math.min(h, group.y1 + KEEP_MARGIN) - y };
  let top = 0;
  for (const p of group.pieces) top = Math.max(top, p.id);
  const own = new Uint8Array(top + 1);
  for (const p of group.pieces) own[p.id] = 1;
  const keep = new Uint8Array(box.w * box.h);
  const isOwn = (i: number) => label[i] <= top && own[label[i]] === 1;
  for (let by = 0; by < box.h; by++) {
    for (let bx = 0; bx < box.w; bx++) {
      const i = (y + by) * w + x + bx;
      if (!isOwn(i)) continue;
      keep[by * box.w + bx] = 1;
      // Only its edge grows.
      if (bx > 0 && by > 0 && bx < box.w - 1 && by < box.h - 1 && isOwn(i - 1) && isOwn(i + 1) && isOwn(i - w) && isOwn(i + w)) continue;
      // Grown into open paper only, never into a neighbour or a letter.
      for (let ny = Math.max(0, by - KEEP_MARGIN); ny <= Math.min(box.h - 1, by + KEEP_MARGIN); ny++) {
        for (let nx = Math.max(0, bx - KEEP_MARGIN); nx <= Math.min(box.w - 1, bx + KEEP_MARGIN); nx++) {
          const l = label[(y + ny) * w + x + nx];
          if (l === 0) keep[ny * box.w + nx] = 1;
        }
      }
    }
  }
  return { box, keep };
}

// ---------------------------------------------------------------------------------------------
// Cutting out

/** Paper added round a cut-out figure, as a share of its longer side. */
const CUT_MARGIN = 0.08;

/**
 * One figure as a picture of its own. `region` is the figure's box cut from any resolution of the picture
 * (normally the original file, for sharpness); neighbours and writing in it are painted over with paper.
 */
export function cutFigure(region: RgbaImage, sheet: FigureSheet, figure: Figure): RgbaImage {
  const { box, keep } = figure;
  const margin = Math.max(2, Math.round(Math.max(region.width, region.height) * CUT_MARGIN));
  const width = region.width + 2 * margin;
  const height = region.height + 2 * margin;
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < data.length; i += 4) data.set(sheet.paper, i);
  const at = (x: number, y: number) =>
    keep[Math.min(box.h - 1, Math.max(0, y)) * box.w + Math.min(box.w - 1, Math.max(0, x))];
  for (let y = 0; y < region.height; y++) {
    const v = ((y + 0.5) * box.h) / region.height - 0.5;
    const y0 = Math.floor(v);
    const fy = v - y0;
    for (let x = 0; x < region.width; x++) {
      const u = ((x + 0.5) * box.w) / region.width - 0.5;
      const x0 = Math.floor(u);
      const fx = u - x0;
      // The mask is interpolated, so the cut stays smooth at higher resolutions.
      const kept =
        (at(x0, y0) * (1 - fx) + at(x0 + 1, y0) * fx) * (1 - fy) + (at(x0, y0 + 1) * (1 - fx) + at(x0 + 1, y0 + 1) * fx) * fy;
      if (kept < 0.5) continue;
      const from = (y * region.width + x) * 4;
      data.set(region.data.subarray(from, from + 4), ((y + margin) * width + x + margin) * 4);
    }
  }
  return { width, height, data };
}

/** The figure's box cut from the image findFigures was given. */
export function figureRegion(image: RgbaImage, figure: Figure): RgbaImage {
  const { x, y, w, h } = figure.box;
  const data = new Uint8ClampedArray(w * h * 4);
  for (let row = 0; row < h; row++) {
    const from = ((y + row) * image.width + x) * 4;
    data.set(image.data.subarray(from, from + w * 4), row * w * 4);
  }
  return { width: w, height: h, data };
}
