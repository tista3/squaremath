// Photo page flow with the image core mocked: pick → layouts → fine-tune → create.
// A file whose name contains "sheet" loads as a 1000×600 "worksheet" with two detected grids.
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes, useParams } from 'react-router-dom';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '../components/ui';
import { loadImageFile } from '../core/image/load';
import { conversionToDesign, convertImage } from '../core/image/pipeline';
import { SOURCE_SIZE, type Conversion, type ConvertParams, type DetectedGrid, type ImageAnalysis } from '../core/image/types';
import { t } from '../i18n';
import { DesignStoreProvider, useDesignStore } from '../state/store';
import PhotoPage from './PhotoPage';

vi.mock('../core/image/load', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../core/image/load')>()),
  loadImageFile: vi.fn(async (file: File) => {
    if (file.name.includes('broken')) throw new Error('unsupported');
    if (file.name.includes('sheet')) return { width: 1000, height: 600, data: new Uint8ClampedArray(0) };
    return { width: 4, height: 4, data: new Uint8ClampedArray(64) };
  }),
}));

vi.mock('../core/image/pipeline', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../core/image/pipeline')>();
  const { createBlankDesign } = await import('../core/design');
  const grid = (x: number, size: number, cols: number, rows: number): DetectedGrid => ({
    box: { x, y: 100, w: size, h: size },
    cols,
    rows,
    cells: Array.from({ length: cols * rows }, () => '#ff0000'),
    confidence: 0.9,
  });
  const base: ConvertParams = { ...actual.DEFAULT_PARAMS, source: 'pixelate', gridIndex: 0 };
  return {
    ...actual,
    analyzeImage: vi.fn((image: ImageAnalysis['image']): ImageAnalysis => {
      const sheet = image.width === 1000;
      return {
        // The working copy is smaller than the loaded (source) image.
        image: sheet ? { width: 500, height: 300, data: new Uint8ClampedArray(0) } : image,
        background: '#ffffff',
        subjectBox: { x: 1, y: 1, w: 2, h: 2 },
        kind: sheet ? 'graphic' : 'photo',
        suggestedColors: 3,
        grids: sheet ? [grid(100, 400, 20, 20), grid(600, 300, 10, 12)] : [],
      };
    }),
    suggestPresets: vi.fn((analysis: ImageAnalysis) => [
      ...analysis.grids.map((_, i) => ({
        id: i === 0 ? 'grid' : `grid-${i + 1}`,
        params: { ...base, source: 'grid' as const, gridIndex: i },
      })),
      { id: 'simple', params: { ...base, width: 8 } },
      { id: 'mystery_mode', params: { ...base, width: 12, algorithm: 'crayon' as const } },
    ]),
    convertImage: vi.fn((analysis: ImageAnalysis, params: ConvertParams): Conversion => {
      const g = params.source === 'grid' ? analysis.grids[params.gridIndex] : undefined;
      const width = g ? g.cols : params.width;
      const height = g ? g.rows : params.width;
      return {
        width,
        height,
        palette: [
          { name: 'White', hex: '#ffffff' },
          { name: 'Red', hex: '#ff0000' },
        ],
        cells: Array.from({ length: width * height }, (_, i) => i % 2),
        backgroundRemoved: params.removeBackground,
      };
    }),
    conversionToDesign: vi.fn((conversion: Conversion, name: string) =>
      createBlankDesign({ name, width: conversion.width, height: conversion.height }),
    ),
  };
});

function EditorStub() {
  const { id = '' } = useParams();
  const design = useDesignStore().get(id);
  return (
    <p className="editor-stub">
      EDITOR {design?.name} {design?.width}x{design?.height}
    </p>
  );
}

describe('PhotoPage', () => {
  let root: Root;
  let container: HTMLDivElement;

  beforeAll(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    window.scrollTo = (() => {}) as typeof window.scrollTo;
  });

  beforeEach(() => {
    localStorage.clear();
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    vi.mocked(convertImage).mockClear();
    vi.mocked(conversionToDesign).mockClear();
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    act(() =>
      root.render(
        <MemoryRouter initialEntries={['/photo']}>
          <DesignStoreProvider>
            <ToastProvider>
              <Routes>
                <Route path="/photo" element={<PhotoPage />} />
                <Route path="/d/:id/:page" element={<EditorStub />} />
              </Routes>
            </ToastProvider>
          </DesignStoreProvider>
        </MemoryRouter>,
      ),
    );
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.restoreAllMocks();
  });

  async function waitFor(check: () => boolean, ms = 2000): Promise<void> {
    for (let waited = 0; !check() && waited < ms; waited += 20) {
      await act(() => new Promise((r) => setTimeout(r, 20)));
    }
    expect(check()).toBe(true);
  }

  async function chooseFile(file: File): Promise<void> {
    const input = container.querySelector<HTMLInputElement>('input[type="file"]:not([capture])');
    expect(input).toBeTruthy();
    Object.defineProperty(input, 'files', { value: [file], configurable: true });
    await act(async () => {
      input!.dispatchEvent(new Event('change', { bubbles: true }));
    });
  }

  async function click(el: Element | null | undefined): Promise<void> {
    expect(el).toBeTruthy();
    await act(async () => {
      el!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 }));
    });
  }

  function setRange(input: HTMLInputElement, value: number): void {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    act(() => {
      setter.call(input, String(value));
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
  }

  const text = () => container.textContent ?? '';
  const rangeLabelled = (label: string) => {
    const lab = [...container.querySelectorAll('label')].find((l) => l.textContent === label);
    return container.querySelector<HTMLInputElement>(`#${CSS.escape(lab?.htmlFor ?? '')}`)!;
  };

  it('starts with a drop zone, a privacy note and both file inputs', () => {
    expect(text()).toContain(t('photo.dropTitle'));
    expect(text()).toContain(t('photo.privacy'));
    expect(container.querySelector('input[type="file"][capture="environment"]')).toBeTruthy();
  });

  it('goes from a photo to a saved design', async () => {
    await chooseFile(new File(['x'], 'my_dog.jpg', { type: 'image/jpeg' }));
    await waitFor(() => container.querySelectorAll('.photo-preset').length === 2);
    expect(text()).toContain(t('photo.preset_simple'));
    expect(text()).toContain('Mystery mode'); // unknown preset id shown readably
    expect(text()).toContain('8×8');
    expect(text()).toContain(t('photo.kind_photo'));
    expect(text()).toContain(t('photo.backgroundFound'));
    expect(container.querySelector('.photo-subject')).toBeTruthy();

    await click(container.querySelector('.photo-preset'));
    expect(container.querySelector('.photo-tuner')).toBeTruthy();
    const nameInput = container.querySelector<HTMLInputElement>('.photo-create input[type="text"]');
    expect(nameInput?.value).toBe('My dog');

    const reset = [...container.querySelectorAll('button')].find((b) => b.textContent === t('photo.reset'))!;
    expect(reset.disabled).toBe(true);
    setRange(rangeLabelled(t('photo.gridWidth')), 10);
    await waitFor(() => text().includes('10 → 10×10'));
    expect(vi.mocked(convertImage).mock.calls.at(-1)?.[1].width).toBe(10);
    expect(reset.disabled).toBe(false);

    await click(reset);
    await waitFor(() => text().includes('8 → 8×8'));

    await click(container.querySelector('.photo-create-button'));
    await waitFor(() => container.querySelector('.editor-stub') !== null);
    expect(text()).toContain('EDITOR My dog 8x8');
    expect(vi.mocked(loadImageFile).mock.calls.at(-1)?.[1]).toBe(SOURCE_SIZE);
    expect(vi.mocked(conversionToDesign).mock.calls.at(-1)?.[0].width).toBe(8);
  });

  it('can go back to the layouts and pick another one', async () => {
    await chooseFile(new File(['x'], 'cat.png', { type: 'image/png' }));
    await waitFor(() => container.querySelectorAll('.photo-preset').length === 2);
    await click(container.querySelectorAll('.photo-preset')[1]);
    expect(text()).toContain('12 → 12×12');
    const back = [...container.querySelectorAll('button')].find((b) => b.textContent === t('photo.backToLayouts'));
    await click(back);
    expect(container.querySelectorAll('.photo-preset')).toHaveLength(2);
  });

  it('explains files that are not pictures or cannot be opened', async () => {
    await chooseFile(new File(['x'], 'notes.pdf', { type: 'application/pdf' }));
    await waitFor(() => text().includes(t('photo.errorNotImage')));
    await chooseFile(new File(['x'], 'broken.jpg', { type: 'image/jpeg' }));
    await waitFor(() => text().includes(t('photo.errorDecode')));
    expect(text()).toContain(t('photo.dropTitle'));
  });

  it('copies a detected grid exactly', async () => {
    await chooseFile(new File(['x'], 'animals_sheet.png', { type: 'image/png' }));
    await waitFor(() => container.querySelectorAll('.photo-preset').length === 4);

    // Detection summary and numbered outlines; the subject box is hidden for grid pictures.
    expect(text()).toContain(t('photo.gridsFound', { count: 2 }));
    expect(text()).toContain(t('photo.gridItem', { n: 2, cols: 10, rows: 12 }));
    const boxes = container.querySelectorAll<HTMLElement>('.photo-grid-box');
    expect(boxes).toHaveLength(2);
    expect([...boxes].map((b) => b.textContent)).toEqual(['1', '2']);
    // Boxes are in source pixels (1000×600), not working-image pixels (500×300).
    expect(boxes[0].style.left).toBe('10%');
    expect(boxes[1].style.width).toBe('30%');
    expect(container.querySelector('.photo-subject')).toBeNull();

    // Grid presets come first, labelled.
    const labels = [...container.querySelectorAll('.photo-preset-label')].map((l) => l.textContent);
    expect(labels.slice(0, 2)).toEqual([t('photo.preset_grid'), t('photo.preset_gridN', { n: 2 })]);
    expect(container.querySelector('.photo-preset')?.textContent).toContain('20×20');

    await click(container.querySelector('.photo-preset'));
    expect(text()).toContain(t('photo.gridSizeValue', { cols: 20, rows: 20 }));
    expect(text()).toContain(t('photo.gridBackgroundHint'));
    for (const key of ['gridWidth', 'sampling', 'crop', 'smoothing', 'saturation', 'contrast', 'tolerance']) {
      expect(text()).not.toContain(t(`photo.${key}`));
    }
    expect(text()).toContain(t('photo.colours'));
    expect(text()).toContain(t('photo.algorithm'));

    // Switch to the second grid without going back.
    await click(container.querySelector(`[aria-label="${t('photo.gridItem', { n: 2, cols: 10, rows: 12 })}"]`));
    await waitFor(() => text().includes(t('photo.gridSizeValue', { cols: 10, rows: 12 })));
    await waitFor(() => text().includes('10×12'));

    await click(container.querySelector('.photo-create-button'));
    await waitFor(() => container.querySelector('.editor-stub') !== null);
    expect(text()).toContain('EDITOR Animals sheet 10x12');
  });

  it('takes a pasted picture', async () => {
    const paste = new Event('paste', { bubbles: true, cancelable: true });
    Object.defineProperty(paste, 'clipboardData', { value: { files: [new File(['x'], 'image.png', { type: 'image/png' })] } });
    await act(async () => {
      window.dispatchEvent(paste);
    });
    expect(paste.defaultPrevented).toBe(true);
    await waitFor(() => container.querySelectorAll('.photo-preset').length === 2);
  });
});
