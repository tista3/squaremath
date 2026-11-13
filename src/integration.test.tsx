// End-to-end wiring checks: real core modules + real store + every route of the app shell.
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import App from './App';
import { decodeDesign, encodeDesign } from './core/codec';
import { libraryToJson, parseLibraryFile } from './core/fileio';
import { generatePuzzle } from './core/puzzle';
import { TEMPLATES } from './core/samples';
import { t } from './i18n';
import { renderDesignSVG, renderSheetSVG } from './render/sheet';
import { STORAGE_KEY } from './state/store';

describe('templates through the whole pipeline', () => {
  it.each(TEMPLATES.map((d) => [d.name, d] as const))('%s: puzzle, sheets, share link, file', (_name, design) => {
    const puzzle = generatePuzzle(design);
    if (!puzzle.ok) throw new Error(`puzzle failed: ${puzzle.error.code}`);
    expect(puzzle.expressions).toHaveLength(design.width * design.height);
    expect(renderSheetSVG(design, puzzle, 'puzzle')).toContain('<svg');
    expect(renderSheetSVG(design, puzzle, 'solution')).toContain('<svg');
    expect(renderDesignSVG(design)).toContain('<svg');

    const shared = decodeDesign(encodeDesign(design));
    expect(shared).not.toBeNull();
    const sharedPuzzle = generatePuzzle(shared!);
    expect(sharedPuzzle.ok && sharedPuzzle.legend.length).toBe(puzzle.legend.length);

    const parsed = parseLibraryFile(libraryToJson([design]));
    expect(parsed?.designs[0].cells).toEqual(design.cells);
  });
});

describe('app routes render without errors', () => {
  let root: Root;
  let container: HTMLDivElement;
  const own = { ...TEMPLATES[0], id: 'own-1', name: 'Mine' };

  beforeAll(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        disconnect() {}
      },
    );
    // jsdom has no canvas: drawing code must cope with a missing 2D context.
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    // Current Chrome returns a Promise from scrollTo; effects must not hand it to React as a cleanup.
    window.scrollTo = (() => Promise.resolve()) as unknown as typeof window.scrollTo;
  });

  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem(STORAGE_KEY, libraryToJson([own]));
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.restoreAllMocks();
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
  });

  async function waitFor(check: () => boolean, ms = 1500): Promise<void> {
    for (let waited = 0; !check() && waited < ms; waited += 20) {
      await act(() => new Promise((r) => setTimeout(r, 20)));
    }
    expect(check()).toBe(true);
  }

  async function click(el: Element | null | undefined): Promise<void> {
    expect(el).toBeTruthy();
    await act(async () => {
      el!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 }));
    });
  }

  const byLabel = (label: string) => container.querySelector(`[aria-label="${label}"]`);
  const mainShown = () => container.querySelector('main') !== null && !container.textContent?.includes(t('common.errorTitle'));

  async function renderAt(hash: string): Promise<string> {
    window.location.hash = hash;
    await act(async () => root.render(<App />));
    // Let lazy page chunks resolve.
    for (let i = 0; i < 150 && container.querySelector('.spinner'); i++) {
      await act(() => new Promise((r) => setTimeout(r, 20)));
    }
    return container.textContent ?? '';
  }

  const payload = encodeDesign(TEMPLATES[1]);
  const cases: [string, string][] = [
    ['gallery', '#/'],
    ['own editor', '#/d/own-1/edit'],
    ['own puzzle', '#/d/own-1/puzzle'],
    ['own solve', '#/d/own-1/solve'],
    ['shared landing', `#/s/${payload}`],
    ['shared puzzle', `#/s/${payload}/puzzle`],
    ['shared solve', `#/s/${payload}/solve`],
  ];

  it.each(cases)('%s', async (_label, hash) => {
    const text = await renderAt(hash);
    expect(container.querySelector('.spinner')).toBeNull();
    expect(text).not.toContain(t('common.errorTitle'));
    expect(text).not.toContain(t('common.notFoundTitle'));
    expect(text).not.toContain(t('common.brokenLinkTitle'));
    expect(text.length).toBeGreaterThan(20);
  });

  it('stays on screen across in-app navigation', async () => {
    await renderAt('#/');
    await click(container.querySelector('a[href="#/d/own-1/solve"]'));
    await waitFor(() => window.location.hash === '#/d/own-1/solve' && !container.querySelector('.spinner'));
    expect(mainShown()).toBe(true);
    await click(container.querySelector('a.brand'));
    await waitFor(() => window.location.hash === '#/');
    expect(mainShown()).toBe(true);
    expect(container.textContent).toContain(t('gallery.myDesigns'));
  });

  it('solves a template without adding a copy to the library', async () => {
    await renderAt('#/');
    const solve = container.querySelector('.template-card a.btn');
    await click(solve);
    await waitFor(() => /^#\/s\/[^/]+\/solve$/.test(window.location.hash));
    await act(() => new Promise((r) => setTimeout(r, 400))); // past the store's write debounce
    expect(parseLibraryFile(localStorage.getItem(STORAGE_KEY) ?? '')?.designs.map((d) => d.id)).toEqual(['own-1']);
  });

  it('focuses the name field of the New design dialog', async () => {
    await renderAt('#/');
    const newButton = [...container.querySelectorAll('button')].find((b) => b.textContent === t('gallery.newDesign'));
    await click(newButton);
    const active = document.activeElement as HTMLInputElement | null;
    expect(active?.tagName).toBe('INPUT');
    expect(active?.placeholder).toBe(t('gallery.defaultName'));
  });

  it('shows the storage banner again on the next page after it was dismissed', async () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('full', 'QuotaExceededError');
    });
    await renderAt('#/');
    await click(byLabel(t('gallery.actionOn', { action: t('gallery.duplicate'), name: 'Mine' })));
    await waitFor(() => container.textContent!.includes(t('common.storageQuota')));
    await click(byLabel(t('common.dismiss')));
    expect(container.textContent).not.toContain(t('common.storageQuota'));
    await click(container.querySelector('a[href="#/d/own-1/puzzle"]'));
    await waitFor(() => container.textContent!.includes(t('common.storageQuota')));
  });

  it('shows the broken-link notice for a damaged share link', async () => {
    expect(await renderAt('#/s/garbage!!')).toContain(t('common.brokenLinkTitle'));
  });
});
