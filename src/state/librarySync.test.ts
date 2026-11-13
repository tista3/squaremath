import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createBlankDesign } from '../core/design';
import { libraryToJson, parseStoredLibrary } from '../core/fileio';
import type { Design } from '../core/types';
import { tombstoneFor } from './library';
import { BACKUP_KEY_PREFIX, LEGACY_STORAGE_KEY, LibrarySync, PERSIST_DELAY_MS, STORAGE_ERRORS, STORAGE_KEY } from './librarySync';
import type { StorageLike } from './librarySync';

/** In-memory localStorage shared by the "tabs"; `deliver` plays the storage event to other tabs. */
class FakeStorage implements StorageLike {
  readonly data = new Map<string, string>();
  quota = Infinity;
  tabs: LibrarySync[] = [];
  getItem(key: string): string | null {
    return this.data.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    const used = [...this.data].reduce((n, [k, v]) => n + (k === key ? 0 : k.length + v.length), 0);
    if (used + key.length + value.length > this.quota) throw new DOMException('full', 'QuotaExceededError');
    this.data.set(key, value);
  }
  removeItem(key: string): void {
    this.data.delete(key);
  }
  /** Fire the storage event in every tab except `from`. */
  deliver(from: LibrarySync | null, key = STORAGE_KEY): void {
    for (const tab of this.tabs) if (tab !== from) tab.receive(key, this.getItem(key));
  }
}

function design(id: string, name: string, updatedAt = 1000): Design {
  return { ...createBlankDesign({ name }), id, createdAt: 1, updatedAt };
}

function rename(tab: LibrarySync, id: string, name: string): void {
  tab.commit({
    designs: tab.designs.map((d) => (d.id === id ? { ...d, name, updatedAt: Math.max(Date.now(), d.updatedAt + 1) } : d)),
    deleted: tab.deleted,
  });
}

const storedNames = (storage: FakeStorage) => {
  const read = parseStoredLibrary(storage.getItem(STORAGE_KEY)!);
  return read.status === 'ok' ? read.designs.map((d) => d.name).sort() : read.status;
};
const namesOf = (tab: LibrarySync) => tab.designs.map((d) => d.name).sort();

describe('LibrarySync', () => {
  let storage: FakeStorage;
  const openTab = () => {
    const tab = new LibrarySync(() => storage);
    storage.tabs.push(tab);
    return tab;
  };

  beforeEach(() => {
    vi.useFakeTimers();
    storage = new FakeStorage();
    storage.setItem(LEGACY_STORAGE_KEY, libraryToJson([design('one', 'One', 2000), design('two', 'Two', 1000)]));
  });

  afterEach(() => vi.useRealTimers());

  it('migrates the old storage key to the compact format', () => {
    const tab = openTab();
    expect(tab.designs.map((d) => d.name)).toEqual(['One', 'Two']);
    vi.advanceTimersByTime(PERSIST_DELAY_MS);
    expect(storage.getItem(LEGACY_STORAGE_KEY)).toBeNull();
    expect(JSON.parse(storage.getItem(STORAGE_KEY)!).version).toBe(2);
    expect(storedNames(storage)).toEqual(['One', 'Two']);
    expect(tab.getSnapshot().storageError).toBeNull();
  });

  it('keeps an edit that is still pending when another tab writes', () => {
    const a = openTab();
    a.flush();
    vi.advanceTimersByTime(PERSIST_DELAY_MS);
    const b = openTab();
    rename(b, 'one', 'One-B');
    vi.advanceTimersByTime(PERSIST_DELAY_MS - 100);
    rename(a, 'two', 'Two-A'); // A's write is pending ...
    vi.advanceTimersByTime(100);
    storage.deliver(b); // ... when B's write arrives
    expect(namesOf(a)).toEqual(['One-B', 'Two-A']);
    vi.advanceTimersByTime(PERSIST_DELAY_MS);
    storage.deliver(a);
    expect(storedNames(storage)).toEqual(['One-B', 'Two-A']);
    expect(namesOf(b)).toEqual(['One-B', 'Two-A']);
  });

  it('a tab that missed events does not overwrite designs other tabs created', () => {
    const a = openTab();
    vi.advanceTimersByTime(PERSIST_DELAY_MS);
    const c = openTab();
    c.commit({ designs: [design('cnew', 'Created in C', 5000), ...c.designs], deleted: c.deleted });
    vi.advanceTimersByTime(PERSIST_DELAY_MS); // no event delivered to A (frozen tab)
    rename(a, 'one', 'Edit in A');
    vi.advanceTimersByTime(PERSIST_DELAY_MS);
    expect(storedNames(storage)).toEqual(['Created in C', 'Edit in A', 'Two']);
    expect(namesOf(a)).toEqual(['Created in C', 'Edit in A', 'Two']);
  });

  it('propagates deletions between tabs', () => {
    const a = openTab();
    vi.advanceTimersByTime(PERSIST_DELAY_MS);
    const b = openTab();
    const target = a.designs.find((d) => d.id === 'two')!;
    a.commit({ designs: a.designs.filter((d) => d.id !== 'two'), deleted: [tombstoneFor(target)] });
    vi.advanceTimersByTime(PERSIST_DELAY_MS);
    // B has a stale copy and writes something else before hearing about the delete.
    rename(b, 'one', 'One-B');
    vi.advanceTimersByTime(PERSIST_DELAY_MS);
    expect(storedNames(storage)).toEqual(['One-B']);
    storage.deliver(b);
    expect(namesOf(a)).toEqual(['One-B']);
  });

  it('re-reads storage when asked (page shown again)', () => {
    const a = openTab();
    vi.advanceTimersByTime(PERSIST_DELAY_MS);
    const b = openTab();
    rename(b, 'two', 'Two-B');
    vi.advanceTimersByTime(PERSIST_DELAY_MS);
    const listener = vi.fn();
    a.subscribe(listener);
    a.syncFromStorage();
    expect(namesOf(a)).toEqual(['One', 'Two-B']);
    expect(listener).toHaveBeenCalled();
  });

  it('follows another tab clearing storage', () => {
    const a = openTab();
    vi.advanceTimersByTime(PERSIST_DELAY_MS);
    storage.data.clear();
    a.receive(null, null);
    expect(a.designs).toEqual([]);
  });

  it('backs up unreadable data before replacing it, and tells the user', () => {
    storage.data.clear();
    storage.setItem(STORAGE_KEY, '{"app":"squaremath","version":2,"designs":{"a":1}}');
    const tab = openTab();
    expect(tab.designs).toEqual([]);
    expect(tab.getSnapshot().storageError).toBe(STORAGE_ERRORS.recovered);
    tab.commit({ designs: [design('n', 'New')], deleted: [] });
    vi.advanceTimersByTime(PERSIST_DELAY_MS);
    const backups = [...storage.data.keys()].filter((k) => k.startsWith(BACKUP_KEY_PREFIX));
    expect(backups).toHaveLength(1);
    expect(storage.getItem(backups[0])).toBe('{"app":"squaremath","version":2,"designs":{"a":1}}');
    expect(storedNames(storage)).toEqual(['New']);
    expect(tab.getSnapshot().storageError).toBe(STORAGE_ERRORS.recovered);
  });

  it('backs up data with designs it cannot read', () => {
    storage.data.clear();
    const raw = JSON.stringify({ app: 'squaremath', version: 2, designs: [design('ok', 'Ok'), { width: 'bad' }] });
    storage.setItem(STORAGE_KEY, raw);
    const tab = openTab();
    expect(tab.designs.map((d) => d.name)).toEqual(['Ok']);
    vi.advanceTimersByTime(PERSIST_DELAY_MS);
    expect([...storage.data.values()]).toContain(raw);
    expect(storedNames(storage)).toEqual(['Ok']);
  });

  it('never writes when there is no room to back up damaged data', () => {
    storage.data.clear();
    storage.setItem(STORAGE_KEY, 'garbage!');
    storage.quota = 20;
    const tab = openTab();
    expect(tab.getSnapshot().storageError).toBe(STORAGE_ERRORS.damaged);
    storage.quota = Infinity;
    tab.commit({ designs: [design('n', 'New')], deleted: [] });
    vi.advanceTimersByTime(PERSIST_DELAY_MS);
    expect(storage.getItem(STORAGE_KEY)).toBe('garbage!');
  });

  it('is read-only for data written by a newer version', () => {
    storage.data.clear();
    const future = JSON.stringify({ app: 'squaremath', version: 3, designs: [design('f', 'Future')] });
    storage.setItem(STORAGE_KEY, future);
    const tab = openTab();
    expect(tab.designs.map((d) => d.name)).toEqual(['Future']);
    expect(tab.getSnapshot().storageError).toBe(STORAGE_ERRORS.newerVersion);
    tab.commit({ designs: [design('n', 'New'), ...tab.designs], deleted: [] });
    vi.advanceTimersByTime(PERSIST_DELAY_MS);
    expect(storage.getItem(STORAGE_KEY)).toBe(future);
  });

  it('goes read-only when another tab of a newer version writes', () => {
    const tab = openTab();
    vi.advanceTimersByTime(PERSIST_DELAY_MS);
    tab.receive(STORAGE_KEY, JSON.stringify({ app: 'squaremath', version: 3, designs: [] }));
    expect(tab.getSnapshot().storageError).toBe(STORAGE_ERRORS.newerVersion);
  });

  it('reports a full storage and clears the error after a good write', () => {
    const tab = openTab();
    storage.quota = 100;
    vi.advanceTimersByTime(PERSIST_DELAY_MS);
    expect(tab.getSnapshot().storageError).toBe(STORAGE_ERRORS.quota);
    storage.quota = Infinity;
    rename(tab, 'one', 'Again');
    vi.advanceTimersByTime(PERSIST_DELAY_MS);
    expect(tab.getSnapshot().storageError).toBeNull();
  });

  it('reports unavailable storage', () => {
    const tab = new LibrarySync(() => {
      throw new DOMException('denied', 'SecurityError');
    });
    expect(tab.designs).toEqual([]);
    expect(tab.getSnapshot().storageError).toBe(STORAGE_ERRORS.unavailable);
  });

  it('keeps the snapshot stable until something changes', () => {
    const tab = openTab();
    const first = tab.getSnapshot();
    expect(tab.getSnapshot()).toBe(first);
    rename(tab, 'one', 'Changed');
    expect(tab.getSnapshot()).not.toBe(first);
    expect(tab.getSnapshot().designs).toBe(tab.designs);
  });
});
