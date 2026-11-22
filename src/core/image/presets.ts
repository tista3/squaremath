// OWNER: image-core agent. Ready-made parameter sets tuned to an analysed image.
import { GRID_MAX, GRID_MIN } from '../types';
import { PARAM_LIMITS } from './types';
import type { ConvertParams, ImageAnalysis, Preset } from './types';

/**
 * Pixelation preset ids in display order ('whole' only when a background was found). Also i18n keys:
 * photo.preset_<id>. Detected grids come first as 'grid', 'grid-2', 'grid-3', … (GRID_PRESET_ID + index).
 */
export const PRESET_IDS = ['simple', 'balanced', 'detailed', 'crayon', 'poster', 'whole'] as const;
export type PresetId = (typeof PRESET_IDS)[number];
export const GRID_PRESET_ID = 'grid';

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export function presetsFor(a: ImageAnalysis, base: ConvertParams): Preset[] {
  const hasBg = a.background !== null;
  const graphic = a.kind === 'graphic';
  const sc = a.suggestedColors;
  // Drawings get their own palette and sampling: outlines, faces and pale bodies survive small grids.
  const algorithm = graphic ? 'fills' : 'kmeans';
  const sampling = graphic ? 'drawing' : 'dominant';
  const common: ConvertParams = {
    ...base,
    source: 'pixelate',
    gridIndex: 0,
    removeBackground: hasBg,
    backgroundTolerance: base.backgroundTolerance,
    crop: hasBg ? 'subject' : 'full',
    saturation: 0,
    contrast: 0,
  };
  const presets: Preset[] = [
    {
      id: 'simple',
      params: {
        ...common,
        width: 14,
        colors: graphic ? clamp(sc, 2, 5) : 4,
        algorithm,
        sampling,
        smoothing: 1,
        saturation: 15,
        contrast: 10,
      },
    },
    {
      id: 'balanced',
      params: {
        ...common,
        width: 20,
        // One spare colour for drawings: cheeks, a tongue, the stroke round a pale body.
        colors: graphic ? clamp(sc + 1, 2, 7) : 6,
        algorithm,
        sampling,
        smoothing: 1,
        saturation: graphic ? 0 : 10,
      },
    },
    {
      id: 'detailed',
      params: {
        ...common,
        width: 32,
        colors: graphic ? clamp(sc + 2, 3, 10) : clamp(sc + 2, 8, 10),
        algorithm,
        sampling: graphic ? 'drawing' : 'average',
        smoothing: 1,
        saturation: graphic ? 0 : 10,
      },
    },
    {
      id: 'crayon',
      params: {
        ...common,
        width: 24,
        colors: graphic ? clamp(sc + 1, 2, 8) : 6,
        algorithm: 'crayon',
        sampling,
        smoothing: 1,
        saturation: 10,
      },
    },
    {
      id: 'poster',
      params: {
        ...common,
        width: 18,
        colors: graphic ? clamp(sc, 2, 5) : 5,
        // Posterising keeps only the most used levels, which costs a drawing its eyes and cheeks.
        algorithm: graphic ? 'fills' : 'posterize',
        sampling,
        smoothing: 1,
        saturation: 30,
        contrast: 20,
      },
    },
  ];
  // Grid pictures first: each detected grid taken 1:1 with all its colours.
  const gridPresets: Preset[] = (a.grids ?? []).map((g, i) => ({
    id: i === 0 ? 'grid' : `grid-${i + 1}`,
    params: {
      ...base,
      source: 'grid',
      gridIndex: i,
      width: clamp(g.cols, GRID_MIN, GRID_MAX),
      // All of the grid's colours; a grid with more than PARAM_LIMITS.colors.max colours is reduced to that
      // maximum (k-means over the cell colours, weighted by how many cells use them).
      colors: clamp(new Set(g.cells).size, PARAM_LIMITS.colors.min, PARAM_LIMITS.colors.max),
      algorithm: 'kmeans',
      removeBackground: false,
      crop: 'full',
      smoothing: 0,
      saturation: 0,
      contrast: 0,
    },
  }));
  if (hasBg) {
    presets.push({
      id: 'whole',
      params: {
        ...common,
        removeBackground: false,
        crop: 'full',
        width: 28,
        colors: graphic ? clamp(sc + 1, 2, 10) : 8,
        algorithm,
        sampling,
        smoothing: 1,
        saturation: graphic ? 0 : 10,
      },
    });
  }
  return [...gridPresets, ...presets];
}
