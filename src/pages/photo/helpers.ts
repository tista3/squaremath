// OWNER: photo-ui agent. Pure helpers of the photo page (no React, no canvas): file picking, names, labels, params.
import { PARAM_LIMITS, type ConvertParams, type ImageAnalysis } from '../../core/image/types';
import { GRID_MAX, GRID_MIN, NAME_MAX } from '../../core/types';
import { t } from '../../i18n';

/** Preset ids the core suggests that have their own label + hint strings (t(`photo.preset_${id}`)). */
export const KNOWN_PRESETS = ['grid', 'simple', 'balanced', 'detailed', 'crayon', 'poster', 'whole'] as const;

function isKnownPreset(id: string): boolean {
  return (KNOWN_PRESETS as readonly string[]).includes(id);
}

/** The number N of a further detected grid's preset id "grid-N" (the first grid's preset is plain "grid"). */
function gridPresetNumber(id: string): number | null {
  const match = /^grid-(\d+)$/.exec(id);
  return match ? Number(match[1]) : null;
}

/** Label of a preset; an unknown id is shown as itself, made readable ("big_bold" → "Big bold"). */
export function presetLabel(id: string): string {
  if (isKnownPreset(id)) return t(`photo.preset_${id}`);
  const n = gridPresetNumber(id);
  if (n !== null) return t('photo.preset_gridN', { n });
  const words = id.replace(/[-_]+/g, ' ').trim();
  return words ? words[0].toUpperCase() + words.slice(1) : id;
}

/** One-line description of a preset, or undefined for ids without one. */
export function presetHint(id: string): string | undefined {
  if (gridPresetNumber(id) !== null) return t('photo.presetHint_grid');
  return isKnownPreset(id) ? t(`photo.presetHint_${id}`) : undefined;
}

/** Automatic names that say nothing about the picture: camera rolls, screenshots, pasted "image.png". */
const AUTO_NAME = /^(img|image|dsc|dscn|dscf|pxl|mvimg|photo|picture|pic|screenshot|screen shot|scan|wp|whatsapp image|foto|bild)?[\s\d]*$/i;

/**
 * A design name from a file name: no extension, separators as spaces, tidy whitespace, capitalised, at most
 * NAME_MAX characters. Camera-roll style names ("IMG_20240501_1234.jpg", "image.png") give `fallback`.
 */
export function nameFromFileName(fileName: string, fallback: string): string {
  const base = fileName.replace(/^.*[\\/]/, '').replace(/\.[a-z0-9]{1,5}$/i, '');
  const words = base
    .replace(/[_\-.+]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!words || AUTO_NAME.test(words) || !/\p{L}/u.test(words)) return fallback;
  return (words[0].toUpperCase() + words.slice(1)).slice(0, NAME_MAX).trim();
}

/** The suggested name of figure number `n` of a sheet: the sheet's name, shortened to leave room for the number. */
export function figureName(sheetName: string, n: number): string {
  const suffix = ` ${n}`;
  return sheetName.slice(0, NAME_MAX - suffix.length).trim() + suffix;
}

/** True for files the browser says are images (a missing type is allowed: the decoder decides). */
export function looksLikeImage(file: Pick<File, 'type' | 'name'>): boolean {
  if (file.type) return file.type.startsWith('image/');
  return /\.(jpe?g|png|webp|gif|bmp|heic|heif|avif)$/i.test(file.name);
}

/** Minimal shape of DataTransfer / ClipboardEvent.clipboardData that we read files from. */
export interface FileSource {
  files?: ArrayLike<File> | null;
  items?: ArrayLike<{ kind: string; type: string; getAsFile(): File | null }> | null;
}

/**
 * The first image file in a drop or paste, else the first file of any kind (so a dropped PDF gets a friendly
 * "not a picture" message), else null (e.g. pasted text).
 */
export function pickFile(source: FileSource | null | undefined): File | null {
  if (!source) return null;
  const files: File[] = Array.from(source.files ?? []);
  if (files.length === 0) {
    for (const item of Array.from(source.items ?? [])) {
      if (item.kind !== 'file') continue;
      const file = item.getAsFile();
      if (file) files.push(file);
    }
  }
  return files.find((f) => looksLikeImage(f)) ?? files[0] ?? null;
}

/** True when a drag carries files (not text or a link dragged from the page). */
export function dragHasFiles(types: ArrayLike<string> | null | undefined): boolean {
  return Array.from(types ?? []).includes('Files');
}

function clampInt(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.round(Number.isFinite(v) ? v : min)));
}

/**
 * Parameters forced into their documented ranges (sliders and presets from the core can't break the UI).
 * With `gridCount` (analysis.grids.length) the grid source is checked too: 'grid' needs an existing grid,
 * otherwise it falls back to 'pixelate'.
 */
export function clampParams(p: ConvertParams, gridCount?: number): ConvertParams {
  const L = PARAM_LIMITS;
  let source: ConvertParams['source'] = p.source === 'grid' ? 'grid' : 'pixelate';
  let gridIndex = Math.max(0, Math.round(Number.isFinite(p.gridIndex) ? p.gridIndex : 0));
  if (gridCount !== undefined) {
    if (gridCount <= 0) source = 'pixelate';
    gridIndex = Math.min(gridIndex, Math.max(0, gridCount - 1));
  }
  return {
    ...p,
    source,
    gridIndex,
    width: clampInt(p.width, GRID_MIN, GRID_MAX),
    colors: clampInt(p.colors, L.colors.min, L.colors.max),
    backgroundTolerance: clampInt(p.backgroundTolerance, L.backgroundTolerance.min, L.backgroundTolerance.max),
    smoothing: clampInt(p.smoothing, L.smoothing.min, L.smoothing.max),
    saturation: clampInt(p.saturation, L.saturation.min, L.saturation.max),
    contrast: clampInt(p.contrast, L.contrast.min, L.contrast.max),
  };
}

export function sameParams(a: ConvertParams, b: ConvertParams): boolean {
  return (Object.keys(a) as (keyof ConvertParams)[]).every((k) => a[k] === b[k]);
}

/** The subject box as percentages of the image, for an overlay drawn over a scaled picture. */
export function subjectBoxPercent(analysis: Pick<ImageAnalysis, 'image' | 'subjectBox'>): {
  left: number;
  top: number;
  width: number;
  height: number;
} {
  return boxPercent(analysis.subjectBox, analysis.image);
}

/** A box in source-image pixels (a detected grid) as percentages of that image. */
export function boxPercent(
  box: { x: number; y: number; w: number; h: number },
  size: { width: number; height: number },
): { left: number; top: number; width: number; height: number } {
  const pct = (v: number, of: number) => (of > 0 ? Math.min(100, Math.max(0, (v / of) * 100)) : 0);
  const left = pct(box.x, size.width);
  const top = pct(box.y, size.height);
  return { left, top, width: Math.min(100 - left, pct(box.w, size.width)), height: Math.min(100 - top, pct(box.h, size.height)) };
}

/** True when the subject box covers (nearly) the whole image, so drawing it adds nothing. */
export function isWholeImage(analysis: Pick<ImageAnalysis, 'image' | 'subjectBox'>): boolean {
  const box = subjectBoxPercent(analysis);
  return box.width * box.height >= 98 * 98;
}
/** Signed percentage for a slider readout: "+20%", "−10%", "0". */
/** Signed percentage for a slider readout: "+20 %", "−10 %", "0". */
export function signedPercent(v: number): string {
  if (v === 0) return '0';
  return `${v > 0 ? '+' : '−'}${Math.abs(v)}%`;
}
