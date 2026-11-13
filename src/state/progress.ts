// OWNER: puzzle-solve agent. Per-design solving progress in localStorage ("squaremath.progress.v1").
import type { Design } from '../core/types';

export const PROGRESS_STORAGE_KEY = 'squaremath.progress.v1';
/** Only the most recently saved entries are kept so the map never grows without bound. */
export const MAX_PROGRESS_ENTRIES = 50;

/**
 * Stored entry. Cells are packed into a string, one char per cell: EMPTY_CHAR for "not coloured",
 * otherwise String.fromCharCode(CHAR_BASE + index into `ids`). Keeps a 40×40 grid at ~1.6k chars.
 */
interface Entry {
  t: number;
  ids: string[];
  d: string;
}
type ProgressMap = Record<string, Entry>;

const EMPTY_CHAR = '-';
const CHAR_BASE = 0x30;

/** 32-bit FNV-1a hash of a string, as 8 hex chars. `basis` lets callers derive independent hashes. */
export function fnv1a(text: string, basis = 0x811c9dc5): string {
  let h = basis >>> 0;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

/** Key that changes whenever the puzzle would change (id + cells + palette ids + puzzle settings hash). */
export function progressKey(d: Design): string {
  const p = d.puzzle;
  const content = [
    `${d.width}x${d.height}`,
    d.palette.map((c) => c.id).join(','),
    d.cells.join(','),
    p.ops.join(','),
    p.addSubMax,
    p.mulDivMax,
    p.legendMode,
    p.seed,
  ].join('|');
  // Two independent 32-bit hashes make accidental collisions practically impossible.
  return `${d.id}:${fnv1a(content)}${fnv1a(content, 0x01234567)}`;
}

function readMap(): ProgressMap {
  try {
    const raw = localStorage.getItem(PROGRESS_STORAGE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as ProgressMap) : {};
  } catch {
    return {};
  }
}

function writeMap(map: ProgressMap): boolean {
  try {
    localStorage.setItem(PROGRESS_STORAGE_KEY, JSON.stringify(map));
    return true;
  } catch {
    return false;
  }
}

/** Keeps the `limit` most recent entries. */
function prune(map: ProgressMap, limit: number): ProgressMap {
  const keys = Object.keys(map);
  if (keys.length <= limit) return map;
  const newest = keys.sort((a, b) => (map[b].t || 0) - (map[a].t || 0)).slice(0, limit);
  return Object.fromEntries(newest.map((k) => [k, map[k]]));
}

function isEntry(v: unknown): v is Entry {
  if (!v || typeof v !== 'object') return false;
  const e = v as Partial<Entry>;
  return Array.isArray(e.ids) && e.ids.every((id) => typeof id === 'string') && typeof e.d === 'string';
}

export function encodeCells(cells: (string | null)[]): { ids: string[]; d: string } {
  const ids: string[] = [];
  const index = new Map<string, number>();
  let d = '';
  for (const c of cells) {
    if (c === null) {
      d += EMPTY_CHAR;
      continue;
    }
    let i = index.get(c);
    if (i === undefined) {
      i = ids.push(c) - 1;
      index.set(c, i);
    }
    d += String.fromCharCode(CHAR_BASE + i);
  }
  return { ids, d };
}

export function decodeCells(ids: string[], d: string): (string | null)[] {
  return Array.from(d, (ch) => (ch === EMPTY_CHAR ? null : (ids[ch.charCodeAt(0) - CHAR_BASE] ?? null)));
}

/** Filled colour id per cell (null = not coloured yet), or null if none saved. */
export function loadProgress(key: string): (string | null)[] | null {
  const entry = readMap()[key];
  return isEntry(entry) ? decodeCells(entry.ids, entry.d) : null;
}

export function saveProgress(key: string, cells: (string | null)[]): void {
  const map = readMap();
  map[key] = { t: Date.now(), ...encodeCells(cells) };
  const kept = prune(map, MAX_PROGRESS_ENTRIES);
  // On quota errors retry once with half the history; progress is a convenience, never fatal.
  if (!writeMap(kept)) writeMap(prune(kept, Math.ceil(MAX_PROGRESS_ENTRIES / 2)));
}

export function clearProgress(key: string): void {
  const map = readMap();
  if (!(key in map)) return;
  delete map[key];
  writeMap(map);
}
