// OWNER: photo-ui agent. Turns a picked file into everything the photo page shows: analysis + preset previews.
import { loadImageFile } from '../../core/image/load';
import { analyzeImage, conversionToDesign, convertImage, DEFAULT_PARAMS, suggestPresets } from '../../core/image/pipeline';
import { SOURCE_SIZE, type Conversion, type ImageAnalysis, type Preset } from '../../core/image/types';
import { svgDataUri } from '../../components/ui';
import { renderDesignSVG } from '../../render/sheet';
import { clampParams, looksLikeImage, nameFromFileName, presetLabel } from './helpers';

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

export type PhotoErrorCode = 'notImage' | 'decode' | 'analyse';

export class PhotoError extends Error {
  constructor(readonly code: PhotoErrorCode) {
    super(code);
  }
}

/** Longest side of a preset thumbnail in px (cells are whole pixels, so it ends up a little smaller). */
const THUMB_PX = 220;

/** Lets the browser paint (spinner, text) between heavy synchronous steps. */
const breathe = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

/**
 * Decode, analyse and pre-render the presets of `file`. Throws PhotoError. `isStale()` is checked between
 * steps: when it returns true (another file was picked meanwhile) the work stops and null is returned.
 */
export async function preparePhoto(file: File, fallbackName: string, isStale: () => boolean): Promise<PhotoSource | null> {
  if (!looksLikeImage(file)) throw new PhotoError('notImage');
  await breathe();
  let analysis: ImageAnalysis;
  let sourceSize: PhotoSource['sourceSize'];
  try {
    const image = await loadImageFile(file, SOURCE_SIZE);
    sourceSize = { width: image.width, height: image.height };
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

  const presets: PresetView[] = [];
  for (const preset of presetsFor(analysis)) {
    await breathe();
    if (isStale()) return null;
    const view = renderPreset(analysis, preset);
    if (view) presets.push(view);
  }
  if (presets.length === 0) throw new PhotoError('analyse');
  return { name: nameFromFileName(file.name, fallbackName), analysis, sourceSize, presets };
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
