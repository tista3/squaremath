// OWNER: photo-ui agent. Turns a picked file into everything the photo page shows: analysis + preset previews.
import { cutFigure, figureRegion, findFigures } from '../../core/image/figures';
import type { FigureSheet } from '../../core/image/figures';
import { loadImageFile } from '../../core/image/load';
import { analyzeImage, conversionToDesign, convertImage, DEFAULT_PARAMS, suggestPresets } from '../../core/image/pipeline';
import { SOURCE_SIZE, type Conversion, type DetectedGrid, type ImageAnalysis, type Preset, type RgbaImage } from '../../core/image/types';
import { svgDataUri } from '../../components/ui';
import { renderDesignSVG } from '../../render/sheet';
import { clampParams, figureName, looksLikeImage, nameFromFileName, presetLabel } from './helpers';

/** A preset with its conversion and thumbnail, computed once per image. */
export interface PresetView {
  preset: Preset;
  label: string;
  conversion: Conversion;
  /** data: URI of the coloured picture (renderDesignSVG). */
  thumb: string;
}

export interface PhotoSource {
  /** Suggested design name (from the file name, or the given fallback). */
  name: string;
  analysis: ImageAnalysis;
  /** Size of the loaded image (long side ≤ SOURCE_SIZE): analysis.grids boxes are in its pixels, while
   *  analysis.image is a smaller working copy of the same picture. */
  sourceSize: { width: number; height: number };
  presets: PresetView[];
}

/** A picture of several separate drawings: one of them is picked before the layouts. */
export interface PhotoSheet {
  /** The original file: a picked figure is cut from its full resolution. */
  file: File;
  name: string;
  /** The loaded picture (long side ≤ SOURCE_SIZE), in whose pixels the figures are. */
  image: RgbaImage;
  found: FigureSheet;
  /** Analysis of the whole picture, for "use the whole picture". */
  analysis: ImageAnalysis;
}

/** What a picked file turns out to be. */
export type PreparedPhoto = { sheet: PhotoSheet } | { source: PhotoSource };

export type PhotoErrorCode = 'notImage' | 'decode' | 'analyse';

export class PhotoError extends Error {
  constructor(readonly code: PhotoErrorCode) {
    super(code);
  }
}

/** Longest side of a preset thumbnail in px (cells are whole pixels, so it ends up a little smaller). */
const THUMB_PX = 220;
/** Detected grids covering this share of what is on the page make it a worksheet, not a sheet of drawings. */
const WORKSHEET_SHARE = 0.25;
/** On a sheet of drawings, a "grid" smaller than this share of the picture is details that happen to line up. */
const STRAY_GRID_SHARE = 0.03;

/** Lets the browser paint (spinner, text) between heavy synchronous steps. */
const breathe = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

/**
 * Decode and analyse `file`: a sheet of several drawings, or a picture with its presets pre-rendered. Throws
 * PhotoError. `isStale()` is checked between steps: when it returns true (another file was picked meanwhile)
 * the work stops and null is returned.
 */
export async function preparePhoto(file: File, fallbackName: string, isStale: () => boolean): Promise<PreparedPhoto | null> {
  if (!looksLikeImage(file)) throw new PhotoError('notImage');
  await breathe();
  let image: RgbaImage;
  let analysis: ImageAnalysis;
  try {
    image = await loadImageFile(file, SOURCE_SIZE);
    if (isStale()) return null;
    await breathe();
    if (isStale()) return null;
    analysis = analyzeImage(image);
    if (!Array.isArray(analysis.grids)) analysis = { ...analysis, grids: [] };
  } catch (error) {
    if (isStale()) return null;
    if (error instanceof Error && error.message === 'unsupported') throw new PhotoError('decode');
    console.error(error);
    throw new PhotoError('analyse');
  }

  const name = nameFromFileName(file.name, fallbackName);
  await breathe();
  if (isStale()) return null;
  const found = sheetOf(image, analysis.grids);
  if (found) {
    const pageArea = image.width * image.height;
    const grids = analysis.grids.filter(({ box }) => box.w * box.h >= pageArea * STRAY_GRID_SHARE);
    return { sheet: { file, name, image, found, analysis: { ...analysis, grids } } };
  }
  const source = await withLayouts(name, analysis, { width: image.width, height: image.height }, isStale);
  return source && { source };
}

/** The figures of a sheet; null for a single picture, a worksheet, or when looking for them fails. */
function sheetOf(image: RgbaImage, grids: DetectedGrid[]): FigureSheet | null {
  try {
    const found = findFigures(image);
    if (!found || grids.length === 0) return found;
    let x0 = Infinity, y0 = Infinity, x1 = 0, y1 = 0;
    for (const { box } of found.figures) {
      x0 = Math.min(x0, box.x);
      y0 = Math.min(y0, box.y);
      x1 = Math.max(x1, box.x + box.w);
      y1 = Math.max(y1, box.y + box.h);
    }
    let gridArea = 0;
    for (const { box } of grids) gridArea += box.w * box.h;
    return gridArea >= (x1 - x0) * (y1 - y0) * WORKSHEET_SHARE ? null : found;
  } catch (error) {
    console.error(error); // the picture as a whole still works
    return null;
  }
}

/** The layouts of the figure with the given index, cut from the original file. Throws PhotoError. */
export async function prepareFigure(sheet: PhotoSheet, index: number, isStale: () => boolean): Promise<PhotoSource | null> {
  const { file, image, found } = sheet;
  const figure = found.figures[index];
  await breathe();
  let region: RgbaImage;
  try {
    const { x, y, w, h } = figure.box;
    region = await loadImageFile(file, SOURCE_SIZE, { x: x / image.width, y: y / image.height, w: w / image.width, h: h / image.height });
  } catch (error) {
    // The file can be gone or changed on disk by now: the copy in memory is a little less sharp.
    console.warn(error);
    region = figureRegion(image, figure);
  }
  if (isStale()) return null;
  let cut: RgbaImage;
  let analysis: ImageAnalysis;
  try {
    cut = cutFigure(region, found, figure);
    analysis = analyzeImage(cut);
    if (!Array.isArray(analysis.grids)) analysis = { ...analysis, grids: [] };
  } catch (error) {
    console.error(error);
    throw new PhotoError('analyse');
  }
  return withLayouts(figureName(sheet.name, index + 1), analysis, { width: cut.width, height: cut.height }, isStale);
}

/** The layouts of a sheet taken as one picture. Throws PhotoError. */
export function prepareWholeSheet(sheet: PhotoSheet, isStale: () => boolean): Promise<PhotoSource | null> {
  return withLayouts(sheet.name, sheet.analysis, { width: sheet.image.width, height: sheet.image.height }, isStale);
}

async function withLayouts(
  name: string,
  analysis: ImageAnalysis,
  sourceSize: PhotoSource['sourceSize'],
  isStale: () => boolean,
): Promise<PhotoSource | null> {
  const presets: PresetView[] = [];
  for (const preset of presetsFor(analysis)) {
    await breathe();
    if (isStale()) return null;
    const view = renderPreset(analysis, preset);
    if (view) presets.push(view);
  }
  if (presets.length === 0) throw new PhotoError('analyse');
  return { name, analysis, sourceSize, presets };
}

/** The core's suggestions (clamped, unique ids); one default preset when it offers none. */
function presetsFor(analysis: ImageAnalysis): Preset[] {
  let suggested: Preset[] = [];
  try {
    suggested = suggestPresets(analysis);
  } catch (error) {
    console.error(error);
  }
  const seen = new Set<string>();
  const unique = suggested.filter((p) => p && typeof p.id === 'string' && !seen.has(p.id) && seen.add(p.id));
  const gridCount = analysis.grids.length;
  if (unique.length > 0) return unique.map((p) => ({ id: p.id, params: clampParams(p.params, gridCount) }));
  return [
    {
      id: 'balanced',
      params: clampParams(
        { ...DEFAULT_PARAMS, colors: analysis.suggestedColors, removeBackground: analysis.background !== null },
        gridCount,
      ),
    },
  ];
}

function renderPreset(analysis: ImageAnalysis, preset: Preset): PresetView | null {
  const label = presetLabel(preset.id);
  try {
    const conversion = convertImage(analysis, preset.params);
    const design = conversionToDesign(conversion, label);
    const cellPx = Math.max(2, Math.floor(THUMB_PX / Math.max(design.width, design.height)));
    return { preset, label, conversion, thumb: svgDataUri(renderDesignSVG(design, { cellPx })) };
  } catch (error) {
    console.error(error);
    return null;
  }
}
