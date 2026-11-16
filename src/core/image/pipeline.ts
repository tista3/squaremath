// OWNER: image-core agent. Public API of the photo → design pipeline (pure functions, no DOM).
import { UNTITLED, cleanName, newId } from '../design';
import { maxColorsFor, randomSeed } from '../puzzle';
import { ADD_SUB_LIMITS, DEFAULT_PRINT, DEFAULT_PUZZLE } from '../types';
import type { Design, PaletteColor, PuzzleSettings } from '../types';
import { analyze } from './analyze';
import { convert } from './convert';
import { detectGrids } from './grid';
import { presetsFor } from './presets';
import type { Conversion, ConvertParams, ImageAnalysis, Preset, RgbaImage } from './types';

export { GRID_PRESET_ID, PRESET_IDS } from './presets';
export type { PresetId } from './presets';

/** Sensible defaults for a fresh image (the presets refine them per image). */
export const DEFAULT_PARAMS: ConvertParams = {
  source: 'pixelate',
  gridIndex: 0,
  width: 20,
  colors: 6,
  algorithm: 'kmeans',
  sampling: 'dominant',
  removeBackground: true,
  backgroundTolerance: 30,
  crop: 'subject',
  smoothing: 1,
  saturation: 0,
  contrast: 0,
};

/** Downscale to WORKING_SIZE, detect the background, the subject's bounding box, photo vs graphic, and a colour count. */
export function analyzeImage(image: RgbaImage): ImageAnalysis {
  return { ...analyze(image), grids: detectGrids(image) };
}

/** 4–6 distinct, good starting points for this image (e.g. simple / detailed / bold / crayon / full picture). */
export function suggestPresets(analysis: ImageAnalysis): Preset[] {
  return presetsFor(analysis, DEFAULT_PARAMS);
}

/** Pure and deterministic; fast enough to run on every slider change (≲ 50 ms for 40×40). */
export function convertImage(analysis: ImageAnalysis, params: ConvertParams): Conversion {
  return convert(analysis, params);
}

/**
 * A new Design (fresh ids, timestamps now, default print settings, random puzzle seed) from a conversion.
 * Puzzle settings must give enough different answers for the colour count; blankBackground is on only when
 * the background was removed (otherwise the most common colour would lose its sums).
 */
export function conversionToDesign(conversion: Conversion, name: string): Design {
  const taken = new Set<string>();
  const palette: PaletteColor[] = conversion.palette.map((c) => {
    let id = newId();
    while (taken.has(id)) id = newId();
    taken.add(id);
    return { id, name: cleanName(c.name) || 'Colour', hex: c.hex.toLowerCase() };
  });
  const counts = new Array<number>(palette.length).fill(0);
  for (const i of conversion.cells) counts[i]++;
  let bgIndex = 0;
  if (!conversion.backgroundRemoved) counts.forEach((n, i) => n > counts[bgIndex] && (bgIndex = i));
  const puzzleColors = counts.filter((n, i) => n > 0 && !(conversion.backgroundRemoved && i === 0)).length;
  const now = Date.now();
  return {
    id: newId(),
    name: cleanName(name) || UNTITLED,
    width: conversion.width,
    height: conversion.height,
    palette,
    backgroundId: palette[bgIndex].id,
    cells: conversion.cells.map((i) => palette[i].id),
    puzzle: puzzleFor(puzzleColors, conversion.backgroundRemoved),
    print: { ...DEFAULT_PRINT },
    createdAt: now,
    updatedAt: now,
  };
}

/** Addition & subtraction with a limit that leaves every colour a few answers (20 for up to 7 colours). */
export function puzzleFor(colors: number, blankBackground: boolean): PuzzleSettings {
  let addSubMax = colors <= 7 ? 20 : Math.min(ADD_SUB_LIMITS.max, Math.ceil((colors * 3) / 10) * 10);
  const settings = (max: number): PuzzleSettings => ({
    ...DEFAULT_PUZZLE,
    ops: ['add', 'sub'],
    addSubMax: max,
    seed: randomSeed(),
    blankBackground,
  });
  while (maxColorsFor(settings(addSubMax)) < colors && addSubMax < ADD_SUB_LIMITS.max) addSubMax += 10;
  return settings(addSubMax);
}
