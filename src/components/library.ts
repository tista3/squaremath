// OWNER: shell agent. Library helpers shared by the app shell and the gallery (export file, import summary,
// finding the user's existing copy of a template / shared design).
import { libraryToJson } from '../core/fileio';
import type { Design } from '../core/types';
import { downloadBlob } from '../export';
import { t } from '../i18n';

/** Larger files cannot be a SquareMath library (browser storage holds ~5 MB); refuse before reading them. */
export const MAX_IMPORT_BYTES = 20 * 1024 * 1024;

export function todayStamp(now = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

export function downloadDesignsJson(designs: Design[], fileName: string): void {
  downloadBlob(new Blob([libraryToJson(designs)], { type: 'application/json' }), fileName);
}

/** Saves the whole library as "squaremath-library-<date>.json". */
export function downloadLibrary(designs: Design[]): void {
  downloadDesignsJson(designs, `squaremath-library-${todayStamp()}.json`);
}

/** Short, plain-language summary of an import; only the non-zero parts are mentioned. */
export function importSummary({
  added,
  updated = 0,
  skipped,
  invalid,
}: {
  added: number;
  /** Newer versions of designs already in the library, replaced in place. */
  updated?: number;
  skipped: number;
  invalid: number;
}): string {
  const parts: string[] = [];
  if (added > 0) parts.push(t('gallery.importAdded', { count: added }));
  if (updated > 0) parts.push(t('gallery.importUpdated', { count: updated }));
  if (skipped > 0) {
    const allPresent = added === 0 && updated === 0 && invalid === 0;
    parts.push(t(allPresent ? 'gallery.importAllPresent' : 'gallery.importSkipped', { count: skipped }));
  }
  if (invalid > 0) parts.push(t('gallery.importInvalidCount', { count: invalid }));
  return parts.join(' · ');
}

/** The picture of a design: everything a copy keeps from its source, except name, settings and timestamps. */
function samePicture(a: Design, b: Design): boolean {
  if (a.width !== b.width || a.height !== b.height || a.backgroundId !== b.backgroundId) return false;
  if (a.palette.length !== b.palette.length || a.cells.length !== b.cells.length) return false;
  const paletteEqual = a.palette.every((c, i) => {
    const o = b.palette[i];
    return c.id === o.id && c.hex === o.hex && c.name === o.name;
  });
  return paletteEqual && a.cells.every((c, i) => c === b.cells[i]);
}

/**
 * The user's most recent library design showing the same picture as `source` (a template or a shared design),
 * i.e. a copy saved earlier and not redrawn since. Used to reopen it instead of piling up identical copies.
 */
export function findCopyOf(designs: Design[], source: Design): Design | undefined {
  let best: Design | undefined;
  for (const d of designs) {
    if (d.id !== source.id && samePicture(d, source) && (!best || d.updatedAt > best.updatedAt)) best = d;
  }
  return best;
}
