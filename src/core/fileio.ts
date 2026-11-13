// OWNER: core-data agent. Library file formats.
//
//   Export file (LibraryFile, version 1): readable JSON, cells as arrays of palette ids.
//   Local storage (version 2): the same envelope, but each design's cells are one CELL_ALPHABET character
//     per palette index (about 7× smaller), plus `deleted` tombstones so deletions reach other tabs.
// Both readers accept either cell encoding. A file from a NEWER app version is never read as an older one.
import { CELL_ALPHABET, cellsToString, cleanId, normalizeDesign } from './design';
import { GRID_MAX } from './types';
import type { Design, LibraryFile } from './types';

/** Upper bound on designs read from one file (keeps a hostile file from freezing the tab). */
const MAX_IMPORT = 5000;
/** Newest format this build understands (the local-storage format). */
export const STORED_VERSION = 2;
const MAX_TOMBSTONES = 1000;

/** A design deleted at `at` (epoch ms). Versions with updatedAt < at are dropped when libraries merge. */
export interface Tombstone {
  id: string;
  at: number;
}

export function libraryToJson(designs: Design[]): string {
  const file: LibraryFile = { app: 'squaremath', version: 1, exportedAt: Date.now(), designs };
  return JSON.stringify(file);
}

/** Compact local-storage form of the library (see the header comment). */
export function storedLibraryToJson(designs: Design[], deleted: Tombstone[]): string {
  return JSON.stringify({
    app: 'squaremath',
    version: STORED_VERSION,
    savedAt: Date.now(),
    designs: designs.map((d) => ({ ...d, cells: cellsToString(d) })),
    deleted,
  });
}

type Rec = Record<string, unknown>;

function isRecord(v: unknown): v is Rec {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function own(obj: Rec, key: string): unknown {
  return Object.hasOwn(obj, key) ? obj[key] : undefined;
}

/** True when the data declares a format version this build does not know yet. */
/** True for a SquareMath file written by a newer app version (it cannot be imported by this one). */
export function isNewerLibraryFile(text: string): boolean {
  try {
    return isNewerFormat(JSON.parse(text));
  } catch {
    return false;
  }
}

function isNewerFormat(data: unknown): boolean {
  if (!isRecord(data)) return false;
  const version = own(data, 'version');
  return typeof version === 'number' && version > STORED_VERSION;
}

/** Compact cells (a string of palette indexes) → array of the raw palette ids; other input unchanged. */
function expandCells(raw: unknown): unknown {
  if (!isRecord(raw)) return raw;
  const cells = own(raw, 'cells');
  const palette = own(raw, 'palette');
  if (typeof cells !== 'string' || !Array.isArray(palette)) return raw;
  const ids = palette.map((p) => (isRecord(p) ? own(p, 'id') : undefined));
  return { ...raw, cells: Array.from(cells.slice(0, GRID_MAX * GRID_MAX), (ch) => ids[CELL_ALPHABET.indexOf(ch)] ?? null) };
}

/** The list of raw design candidates in a parsed file, or null when the shape is not recognised. */
function rawDesigns(data: unknown): unknown[] | null {
  if (Array.isArray(data)) return data;
  if (!isRecord(data)) return null;
  const designs = own(data, 'designs');
  if (Array.isArray(designs)) return designs;
  const looksLikeDesign = Object.hasOwn(data, 'cells') || Object.hasOwn(data, 'palette');
  return looksLikeDesign ? [data] : null;
}

function readDesigns(data: unknown): { designs: Design[]; invalid: number } | null {
  const raws = rawDesigns(data);
  if (!raws) return null;
  const designs: Design[] = [];
  let invalid = Math.max(0, raws.length - MAX_IMPORT);
  for (const raw of raws.slice(0, MAX_IMPORT)) {
    const d = normalizeDesign(expandCells(raw));
    if (d) designs.push(d);
    else invalid++;
  }
  return { designs, invalid };
}

function readTombstones(data: unknown): Tombstone[] {
  const raw = isRecord(data) ? own(data, 'deleted') : undefined;
  if (!Array.isArray(raw)) return [];
  const out: Tombstone[] = [];
  for (const entry of raw.slice(0, MAX_TOMBSTONES)) {
    if (!isRecord(entry)) continue;
    const id = cleanId(own(entry, 'id'));
    const at = own(entry, 'at');
    if (id !== null && typeof at === 'number' && Number.isFinite(at) && at >= 0) out.push({ id, at });
  }
  return out;
}

function parseJson(text: string): { ok: true; data: unknown } | { ok: false } {
  try {
    return { ok: true, data: JSON.parse(text) };
  } catch {
    return { ok: false };
  }
}

/** Accepts a LibraryFile, a single Design object, or an array of designs (either cell encoding). Each
 * design goes through normalizeDesign; invalid ones are counted in `invalid`. Returns null if the text is
 * not JSON, not recognised, or written by a newer app version. */
export function parseLibraryFile(text: string): { designs: Design[]; invalid: number } | null {
  const json = parseJson(text);
  if (!json.ok || isNewerFormat(json.data)) return null;
  return readDesigns(json.data);
}

export type StoredLibrary =
  /** `invalid` designs could not be read and are not in `designs`. */
  | { status: 'ok'; designs: Design[]; deleted: Tombstone[]; invalid: number }
  /** Written by a newer app version: `designs` is a best-effort read-only view, never to be written back. */
  | { status: 'newer'; designs: Design[] }
  | { status: 'unreadable' };

/** Read the library from local storage text (current or any older format). */
export function parseStoredLibrary(text: string): StoredLibrary {
  const json = parseJson(text);
  if (!json.ok) return { status: 'unreadable' };
  const read = readDesigns(json.data);
  if (isNewerFormat(json.data)) return { status: 'newer', designs: read?.designs ?? [] };
  if (!read) return { status: 'unreadable' };
  return { status: 'ok', ...read, deleted: readTombstones(json.data) };
}
