import { describe, expect, it } from 'vitest';
import { createBlankDesign } from '../core/design';
import type { Design } from '../core/types';
import { addTombstone, mergeImported, mergeLibraries, sameVersions, tombstoneFor } from './library';

function design(id: string, name: string, updatedAt: number): Design {
  return { ...createBlankDesign({ name }), id, createdAt: 1, updatedAt };
}

const namesOf = (designs: Design[]) => designs.map((d) => d.name);

describe('mergeLibraries', () => {
  it('keeps the newer version of each design and the local order', () => {
    const a = design('a', 'A', 10);
    const b = design('b', 'B', 20);
    const local = { designs: [a, b], deleted: [] };
    const incoming = { designs: [{ ...b, name: 'B2', updatedAt: 30 }, { ...a, name: 'A-old', updatedAt: 5 }], deleted: [] };
    const merged = mergeLibraries(local, incoming);
    expect(namesOf(merged.designs)).toEqual(['A', 'B2']);
    expect(merged.designs[0]).toBe(a);
  });

  it('puts designs only the other side has first, newest first', () => {
    const local = { designs: [design('a', 'A', 10)], deleted: [] };
    const incoming = { designs: [design('x', 'X', 5), design('y', 'Y', 50), local.designs[0]], deleted: [] };
    expect(namesOf(mergeLibraries(local, incoming).designs)).toEqual(['Y', 'X', 'A']);
  });

  it('applies tombstones from either side unless the design was edited after the delete', () => {
    const now = 1_000_000;
    const a = design('a', 'A', 10);
    const b = design('b', 'B', 10);
    const deletedA = tombstoneFor(a, 100);
    const merged = mergeLibraries({ designs: [b], deleted: [deletedA] }, { designs: [a, b], deleted: [] }, now);
    expect(namesOf(merged.designs)).toEqual(['B']);
    expect(merged.deleted).toEqual([deletedA]);

    const editedLater = { ...a, updatedAt: 200 };
    const revived = mergeLibraries({ designs: [b], deleted: [deletedA] }, { designs: [editedLater, b], deleted: [] }, now);
    expect(namesOf(revived.designs)).toEqual(['A', 'B']);
    expect(revived.deleted).toEqual([]); // superseded tombstone dropped
  });

  it('forgets very old tombstones', () => {
    const now = 100 * 86_400_000;
    const merged = mergeLibraries({ designs: [], deleted: [{ id: 'old', at: 1 }, { id: 'new', at: now - 1000 }] }, { designs: [], deleted: [] }, now);
    expect(merged.deleted).toEqual([{ id: 'new', at: now - 1000 }]);
  });

  it('tombstones are later than the deleted version', () => {
    expect(tombstoneFor(design('a', 'A', 500), 100)).toEqual({ id: 'a', at: 501 });
    expect(tombstoneFor(design('a', 'A', 50), 100)).toEqual({ id: 'a', at: 100 });
    const many = Array.from({ length: 600 }, (_, i) => ({ id: `t${i}`, at: i }));
    const added = addTombstone([{ id: 'a', at: 1 }, ...many], design('a', 'A', 50), 100);
    expect(added[0]).toEqual({ id: 'a', at: 100 });
    expect(added.filter((t) => t.id === 'a')).toHaveLength(1);
    expect(added.length).toBeLessThanOrEqual(500);
  });

  it('sameVersions compares ids and updatedAt', () => {
    const a = design('a', 'A', 1);
    const b = design('b', 'B', 2);
    expect(sameVersions([a, b], [{ ...b }, { ...a }])).toBe(true);
    expect(sameVersions([a, b], [a, { ...b, updatedAt: 3 }])).toBe(false);
    expect(sameVersions([a], [a, b])).toBe(false);
  });
});

describe('mergeImported', () => {
  const now = 5_000_000;
  const alpha = design('alpha', 'Alpha', 100);
  const beta = design('beta', 'Beta', 200);
  const library = { designs: [beta, alpha], deleted: [] };

  it('adds new designs first, in file order, stamped as just updated', () => {
    const r = mergeImported(library, [design('n1', 'New 1', 1), design('n2', 'New 2', 9)], now);
    expect(r).toMatchObject({ added: 2, updated: 0, skipped: 0 });
    expect(namesOf(r.designs)).toEqual(['New 1', 'New 2', 'Beta', 'Alpha']);
    expect(r.designs[0].updatedAt).toBe(now);
    expect(r.designs[0].createdAt).toBe(1);
  });

  it('renames new designs whose name is taken', () => {
    const r = mergeImported(library, [design('n1', 'Alpha', 1), design('n2', 'Alpha', 1)], now);
    expect(namesOf(r.designs)).toEqual(['Alpha (copy)', 'Alpha (copy 2)', 'Beta', 'Alpha']);
  });

  it('replaces older versions in place and skips same or older ones', () => {
    const newerAlpha = { ...alpha, updatedAt: 300, width: 20, cells: new Array(20 * 16).fill(alpha.backgroundId) };
    const olderBeta = { ...beta, name: 'Beta old', updatedAt: 150 };
    const r = mergeImported(library, [newerAlpha, olderBeta, alpha], now);
    expect(r).toMatchObject({ added: 0, updated: 1, skipped: 2 });
    expect(namesOf(r.designs)).toEqual(['Beta', 'Alpha']);
    expect(r.designs[1]).toMatchObject({ id: 'alpha', width: 20, updatedAt: 300 });
  });

  it('skips a newer timestamp with identical content', () => {
    const r = mergeImported(library, [{ ...alpha, updatedAt: 999 }], now);
    expect(r).toMatchObject({ added: 0, updated: 0, skipped: 1 });
  });

  it('a replacing version still gets a free name', () => {
    const r = mergeImported(library, [{ ...alpha, name: 'Beta', updatedAt: 300 }], now);
    expect(namesOf(r.designs)).toEqual(['Beta', 'Beta (copy)']);
  });

  it('re-importing a deleted design brings it back after its tombstone', () => {
    const r = mergeImported({ designs: [beta], deleted: [{ id: 'alpha', at: now + 10 }] }, [alpha], now);
    expect(r.added).toBe(1);
    expect(r.designs[0].updatedAt).toBe(now + 11);
    const merged = mergeLibraries({ designs: r.designs, deleted: [] }, { designs: [beta], deleted: [{ id: 'alpha', at: now + 10 }] }, now);
    expect(namesOf(merged.designs)).toEqual(['Alpha', 'Beta']);
  });
});
