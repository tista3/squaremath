// OWNER: core-data agent. Pure operations on the design library (list in, new list out).
import { cloneDesign, copyName } from '../core/design';
import type { Tombstone } from '../core/fileio';
import type { Design } from '../core/types';

/** The persisted library: designs (display order) plus tombstones of deleted designs. */
export interface Library {
  designs: Design[];
  deleted: Tombstone[];
}

export const EMPTY_LIBRARY: Library = { designs: [], deleted: [] };

/** Tombstones are kept this long, so a tab that was asleep for a while still learns about deletions. */
const TOMBSTONE_TTL_MS = 30 * 86_400_000;
const MAX_TOMBSTONES = 500;

export function sortByUpdated(designs: Design[]): Design[] {
  return [...designs].sort((a, b) => b.updatedAt - a.updatedAt);
}

/** Most recently updated first; for duplicate ids only the most recently updated version is kept. */
export function dedupeSorted(designs: Design[]): Design[] {
  const seen = new Set<string>();
  return sortByUpdated(designs).filter((d) => {
    if (seen.has(d.id)) return false;
    seen.add(d.id);
    return true;
  });
}

export function names(designs: Design[]): string[] {
  return designs.map((d) => d.name);
}

/** A copy for the library: keeps the name unless it clashes with an existing one. */
export function libraryCopy(d: Design, existing: Design[]): Design {
  const taken = names(existing);
  return cloneDesign(d, { name: taken.includes(d.name) ? copyName(d.name, taken) : d.name });
}

/** Tombstones still needed: newest per id, not superseded by a live design, younger than the TTL. */
function liveTombstones(deletedAt: Map<string, number>, designs: Design[], now: number): Tombstone[] {
  const present = new Set(designs.map((d) => d.id));
  return [...deletedAt]
    .filter(([id, at]) => !present.has(id) && at > now - TOMBSTONE_TTL_MS)
    .map(([id, at]) => ({ id, at }))
    .sort((a, b) => b.at - a.at)
    .slice(0, MAX_TOMBSTONES);
}

/** Tombstone for deleting `d` now (always later than its last update, so the delete wins the merge). */
export function tombstoneFor(d: Design, now = Date.now()): Tombstone {
  return { id: d.id, at: Math.max(now, d.updatedAt + 1) };
}

/** `deleted` plus a tombstone for `d` (newest first, bounded). */
export function addTombstone(deleted: Tombstone[], d: Design, now = Date.now()): Tombstone[] {
  return [tombstoneFor(d, now), ...deleted.filter((t) => t.id !== d.id)].slice(0, MAX_TOMBSTONES);
}

/** Merge two copies of the library (this tab's and another tab's / stored one), per design id:
 * the higher updatedAt wins, and a design is dropped when its tombstone is newer than it.
 * The order of `local` is kept (no card jumps); designs only `incoming` has go first, newest first.
 * Designs of `local` that win are returned as the same objects. */
export function mergeLibraries(local: Library, incoming: Library, now = Date.now()): Library {
  const deletedAt = new Map<string, number>();
  for (const t of [...local.deleted, ...incoming.deleted]) deletedAt.set(t.id, Math.max(deletedAt.get(t.id) ?? 0, t.at));
  const alive = (d: Design) => !((deletedAt.get(d.id) ?? -1) > d.updatedAt);

  const theirs = new Map(incoming.designs.map((d) => [d.id, d]));
  const kept: Design[] = [];
  for (const mine of local.designs) {
    const other = theirs.get(mine.id);
    theirs.delete(mine.id);
    const winner = other && other.updatedAt > mine.updatedAt ? other : mine;
    if (alive(winner)) kept.push(winner);
  }
  const arrivals = sortByUpdated([...theirs.values()].filter(alive));
  const designs = [...arrivals, ...kept];
  return { designs, deleted: liveTombstones(deletedAt, designs, now) };
}

/** True when both lists hold the same design versions (ids and updatedAt), in any order. */
export function sameVersions(a: Design[], b: Design[]): boolean {
  if (a.length !== b.length) return false;
  const versions = new Map(a.map((d) => [d.id, d.updatedAt]));
  return b.every((d) => versions.get(d.id) === d.updatedAt);
}

/** Everything except id and timestamps. */
function sameContent(a: Design, b: Design): boolean {
  const strip = (d: Design) => JSON.stringify({ ...d, id: '', createdAt: 0, updatedAt: 0 });
  return strip(a) === strip(b);
}

export interface ImportResult {
  designs: Design[];
  /** New designs, put first (in file order) with updatedAt = now so they are easy to find. */
  added: number;
  /** Designs already in the library (same id) that the file has a newer version of: replaced in place. */
  updated: number;
  /** Same or older versions of designs already in the library. */
  skipped: number;
}

/** Merge designs from an imported file. Names never clash: a taken name gets copyName(). */
export function mergeImported(current: Library, incoming: Design[], now = Date.now()): ImportResult {
  const designs = [...current.designs];
  const deletedAt = new Map(current.deleted.map((t) => [t.id, t.at]));
  const position = new Map(designs.map((d, i) => [d.id, i]));
  const taken = new Set(names(designs));
  const freeName = (name: string) => {
    const free = taken.has(name) ? copyName(name, [...taken]) : name;
    taken.add(free);
    return free;
  };
  const arrivals: Design[] = [];
  let updated = 0;
  let skipped = 0;
  for (const d of incoming) {
    const at = position.get(d.id);
    if (at === undefined) {
      // A new design (also when the same file lists an id twice: the first one wins).
      position.set(d.id, -1);
      // Newer than any tombstone, so re-importing a deleted design brings it back.
      arrivals.push({ ...d, name: freeName(d.name), updatedAt: Math.max(now, (deletedAt.get(d.id) ?? 0) + 1) });
      continue;
    }
    const existing = at >= 0 ? designs[at] : undefined;
    if (!existing || d.updatedAt <= existing.updatedAt || sameContent(d, existing)) {
      skipped++;
      continue;
    }
    taken.delete(existing.name);
    designs[at] = { ...d, name: freeName(d.name) };
    updated++;
  }
  return { designs: [...arrivals, ...designs], added: arrivals.length, updated, skipped };
}
