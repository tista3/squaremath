// Photo → design conversion: shared contract between the image pipeline (src/core/image/*) and the photo page.
// Everything runs locally in the browser; images are never uploaded.

/** RGBA pixels, row-major, like ImageData (data.length === width * height * 4). */
export interface RgbaImage {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

/**
 * How the picture's colours are chosen:
 * - 'kmeans': k-means clustering in CIELAB (k-means++ seeding, deterministic) — the most faithful colours.
 * - 'median-cut': median cut box splitting — fast, keeps small but distinct colours.
 * - 'crayon': each colour snapped to the nearest named crayon colour (TEMPLATE_COLORS), then the `colors`
 *   most used ones are kept — bright kid-friendly colours with exact English names.
 * - 'posterize': few levels per channel, then the most used `colors` — bold, poster-like.
 */
export type ColorAlgorithm = 'kmeans' | 'median-cut' | 'crayon' | 'posterize';
export const COLOR_ALGORITHMS: ColorAlgorithm[] = ['kmeans', 'median-cut', 'crayon', 'posterize'];

/** 'subject': crop to the detected subject (+ small margin); 'full': whole image; 'square': square around the subject. */
export type CropMode = 'subject' | 'full' | 'square';
export const CROP_MODES: CropMode[] = ['subject', 'full', 'square'];

/** How one grid cell gets its colour from the pixels it covers: their mean, or the most common colour. */
export type CellSampling = 'average' | 'dominant';

export interface ConvertParams {
  /**
   * 'pixelate': resample the (cropped) image into a width × rows grid — for photos and drawings.
   * 'grid': the image already IS a grid picture (e.g. a screenshot of a colour-by-number page): take the detected
   * grid analysis.grids[gridIndex] cell by cell (1:1). Only colors, algorithm and removeBackground apply then.
   */
  source: 'pixelate' | 'grid';
  /** Index into analysis.grids when source === 'grid'. */
  gridIndex: number;
  /** Grid columns (GRID_MIN..GRID_MAX); rows follow the cropped aspect ratio (clamped to GRID_MIN..GRID_MAX). */
  width: number;
  /** Picture colours, not counting a removed background (PARAM_LIMITS.colors). */
  colors: number;
  algorithm: ColorAlgorithm;
  sampling: CellSampling;
  /** Replace the detected background with White (the design's blank background). */
  removeBackground: boolean;
  /** 0..100: how far from the background colour a pixel may be and still count as background. */
  backgroundTolerance: number;
  crop: CropMode;
  /** Speckle clean-up: passes of a majority filter that removes lonely cells (0 = off). */
  smoothing: number;
  /** Colour tweaks before quantising, in percent (−50..+50, 0 = unchanged). */
  saturation: number;
  contrast: number;
}

export const PARAM_LIMITS = {
  colors: { min: 2, max: 12 },
  backgroundTolerance: { min: 0, max: 100 },
  smoothing: { min: 0, max: 3 },
  saturation: { min: -50, max: 50 },
  contrast: { min: -50, max: 50 },
} as const;

export interface ImageAnalysis {
  /** Downscaled working copy (long side ≤ WORKING_SIZE px) that every conversion uses. */
  image: RgbaImage;
  /** Background colour estimated from the image border ('#rrggbb'), or null when the border is too varied. */
  background: string | null;
  /** Bounding box of the subject in working-image pixels (the whole image when no background was found). */
  subjectBox: { x: number; y: number; w: number; h: number };
  /** 'graphic' = few flat colours (drawing, clip art, logo); 'photo' = continuous tones. */
  kind: 'graphic' | 'photo';
  /** Colour count that captures the image well (within PARAM_LIMITS.colors). */
  suggestedColors: number;
  /**
   * Regular colour grids found in the image (a screenshot or scan of a pixel / colour-by-number picture), largest
   * first; empty when the image is not a grid picture. Detected at SOURCE_SIZE resolution.
   */
  grids: DetectedGrid[];
}

/** A regular grid of flat-coloured cells found in the image. */
export interface DetectedGrid {
  /** Outer bounds of the grid in the analysed (source) image's pixels. */
  box: { x: number; y: number; w: number; h: number };
  cols: number;
  rows: number;
  /** Fill colour per cell ('#rrggbb'), row-major — ignoring grid lines and anything printed in the cell (numbers, sums). */
  cells: string[];
  /** 0..1: how regular the grid lines and how flat the cells are. */
  confidence: number;
}

export const WORKING_SIZE = 512;
/** Images are loaded up to this long side so that grids with small cells can still be detected exactly. */
export const SOURCE_SIZE = 2048;

/** A ready-made parameter set offered as a thumbnail; the user can pick one and fine-tune it. */
export interface Preset {
  /** Stable id, also the i18n key suffix: t(`photo.preset_${id}`). */
  id: string;
  params: ConvertParams;
}

/** Result of a conversion: everything needed to build a Design. */
export interface Conversion {
  width: number;
  height: number;
  /** Colours with English names (unique). When `backgroundRemoved`, palette[0] is White = the background. */
  palette: { name: string; hex: string }[];
  /** Palette index per cell, row-major, length width * height. */
  cells: number[];
  backgroundRemoved: boolean;
}
