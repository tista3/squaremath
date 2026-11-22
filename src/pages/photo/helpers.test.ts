import { NAME_MAX } from '../../core/types';
import { describe, expect, it } from 'vitest';
import { DEFAULT_PARAMS } from '../../core/image/pipeline';
import { t } from '../../i18n';
import {
  figureName,
  boxPercent,
  clampParams,
  dragHasFiles,
  isWholeImage,
  KNOWN_PRESETS,
  looksLikeImage,
  nameFromFileName,
  pickFile,
  presetHint,
  presetLabel,
  sameParams,
  signedPercent,
  subjectBoxPercent,
} from './helpers';

const file = (name: string, type: string) => new File(['x'], name, { type });

describe('nameFromFileName', () => {
  it('drops the extension, tidies separators and capitalises', () => {
    expect(nameFromFileName('my_cat-tom.jpg', 'X')).toBe('My cat tom');
    expect(nameFromFileName('  Grandma  house.PNG', 'X')).toBe('Grandma house');
    expect(nameFromFileName('C:\\fakepath\\rocket.webp', 'X')).toBe('Rocket');
  });

  it('uses the fallback for camera-roll and pasted names', () => {
    for (const n of ['IMG_20240501_123456.jpg', 'image.png', 'DSC01234.JPG', 'PXL_20230101_101010123.jpg', '12345.png', '', '.png']) {
      expect(nameFromFileName(n, 'My photo')).toBe('My photo');
    }
  });

  it('keeps names with letters in any script and caps the length', () => {
    expect(nameFromFileName('čáp.jpg', 'X')).toBe('Čáp');
    expect(nameFromFileName(`${'a'.repeat(100)}.jpg`, 'X')).toHaveLength(60);
  });
});

describe('file picking', () => {
  it('recognises images by type or extension', () => {
    expect(looksLikeImage(file('a.jpg', 'image/jpeg'))).toBe(true);
    expect(looksLikeImage(file('a.pdf', 'application/pdf'))).toBe(false);
    expect(looksLikeImage(file('a.heic', ''))).toBe(true);
    expect(looksLikeImage(file('notes.txt', ''))).toBe(false);
  });

  it('prefers an image among dropped files and falls back to the first file', () => {
    const pdf = file('a.pdf', 'application/pdf');
    const png = file('b.png', 'image/png');
    expect(pickFile({ files: [pdf, png] })).toBe(png);
    expect(pickFile({ files: [pdf] })).toBe(pdf);
    expect(pickFile({ files: [] })).toBeNull();
    expect(pickFile(null)).toBeNull();
  });

  it('reads clipboard items when there is no file list', () => {
    const png = file('image.png', 'image/png');
    const items = [
      { kind: 'string', type: 'text/plain', getAsFile: () => null },
      { kind: 'file', type: 'image/png', getAsFile: () => png },
    ];
    expect(pickFile({ files: [], items })).toBe(png);
    expect(pickFile({ items: [items[0]] })).toBeNull();
  });

  it('detects file drags', () => {
    expect(dragHasFiles(['text/plain', 'Files'])).toBe(true);
    expect(dragHasFiles(['text/uri-list'])).toBe(false);
    expect(dragHasFiles(undefined)).toBe(false);
  });
});

describe('preset labels', () => {
  it('has a label and a hint for every known preset id', () => {
    for (const id of KNOWN_PRESETS) {
      expect(presetLabel(id)).toBe(t(`photo.preset_${id}`));
      expect(presetLabel(id)).not.toContain('photo.');
      expect(presetHint(id)).not.toContain('photo.');
    }
  });

  it('labels further grids "Grid N" with the grid hint', () => {
    expect(presetLabel('grid')).toBe(t('photo.preset_grid'));
    expect(presetLabel('grid-3')).toBe('Grid 3');
    expect(presetHint('grid-3')).toBe(t('photo.presetHint_grid'));
  });

  it('shows an unknown id readably and without a hint', () => {
    expect(presetLabel('big_bold')).toBe('Big bold');
    expect(presetLabel('x')).toBe('X');
    expect(presetHint('big_bold')).toBeUndefined();
  });
});

describe('params', () => {
  it('clamps every numeric parameter into its range', () => {
    const p = clampParams({ ...DEFAULT_PARAMS, width: 999, colors: 1, backgroundTolerance: -5, smoothing: 2.6, saturation: 80, contrast: NaN });
    expect(p).toMatchObject({ width: 40, colors: 2, backgroundTolerance: 0, smoothing: 3, saturation: 50, contrast: -50 });
    expect(p.algorithm).toBe(DEFAULT_PARAMS.algorithm);
  });

  it('keeps the grid source valid', () => {
    const grid = { ...DEFAULT_PARAMS, source: 'grid' as const, gridIndex: 5 };
    expect(clampParams(grid, 2)).toMatchObject({ source: 'grid', gridIndex: 1 });
    expect(clampParams(grid, 0)).toMatchObject({ source: 'pixelate', gridIndex: 0 });
    expect(clampParams({ ...grid, gridIndex: -2.4 })).toMatchObject({ source: 'grid', gridIndex: 0 });
    expect(clampParams({ ...grid, source: 'bogus' as never }).source).toBe('pixelate');
  });

  it('compares params by value', () => {
    expect(sameParams(DEFAULT_PARAMS, { ...DEFAULT_PARAMS })).toBe(true);
    expect(sameParams(DEFAULT_PARAMS, { ...DEFAULT_PARAMS, crop: 'full' })).toBe(false);
  });

  it('formats signed percentages', () => {
    expect(signedPercent(0)).toBe('0');
    expect(signedPercent(20)).toBe('+20%');
    expect(signedPercent(-15)).toBe('−15%');
  });
});

describe('subject box', () => {
  const image = { width: 200, height: 100, data: new Uint8ClampedArray(0) };

  it('converts to percentages within the image', () => {
    expect(subjectBoxPercent({ image, subjectBox: { x: 50, y: 25, w: 100, h: 50 } })).toEqual({ left: 25, top: 25, width: 50, height: 50 });
    const outside = subjectBoxPercent({ image, subjectBox: { x: 150, y: 0, w: 100, h: 200 } });
    expect(outside.left + outside.width).toBeLessThanOrEqual(100);
    expect(outside.height).toBe(100);
  });

  it('scales a source-pixel box to percentages', () => {
    expect(boxPercent({ x: 100, y: 60, w: 400, h: 300 }, { width: 1000, height: 600 })).toEqual({ left: 10, top: 10, width: 40, height: 50 });
  });

  it('tells when the box is the whole image', () => {
    expect(isWholeImage({ image, subjectBox: { x: 0, y: 0, w: 200, h: 100 } })).toBe(true);
    expect(isWholeImage({ image, subjectBox: { x: 10, y: 10, w: 100, h: 50 } })).toBe(false);
  });
});

describe('figureName', () => {
  it("numbers a sheet's drawing and keeps the number when the name is long", () => {
    expect(figureName('My characters', 7)).toBe('My characters 7');
    const long = figureName('x'.repeat(NAME_MAX), 151);
    expect(long).toHaveLength(NAME_MAX);
    expect(long.endsWith(' 151')).toBe(true);
  });
});
