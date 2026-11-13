// OWNER: core-data agent. Keeps the in-memory design library and localStorage in step:
//  - writes are debounced, and every write first re-reads storage and merges per design id (newest
//    updatedAt wins, tombstones carry deletions), so neither a stale tab nor a pending edit loses data;
//  - another tab's write (storage event) is merged in, not adopted wholesale;
//  - stored data this build cannot fully read is backed up before it is overwritten, and data from a
//    newer app version is never overwritten at all (read-only session).
// Framework-free so it can be unit-tested with a fake storage; store.tsx wraps it for React.
import { parseStoredLibrary, storedLibraryToJson } from '../core/fileio';
import type { StoredLibrary } from '../core/fileio';
import type { Design } from '../core/types';
import { EMPTY_LIBRARY, dedupeSorted, mergeLibraries, sameVersions } from './library';
import type { Library } from './library';

export const STORAGE_KEY = 'squaremath.designs.v2';
/** Pre-v2 key (cells stored as id arrays); migrated on load and removed after the first write. */
export const LEGACY_STORAGE_KEY = 'squaremath.designs.v1';
/** Raw copies of stored data that could not be fully read are kept under this prefix + timestamp. */
export const BACKUP_KEY_PREFIX = 'squaremath.designs.backup-';
export const PERSIST_DELAY_MS = 300;

/** English fallback messages for DesignStore.storageError. */
export const STORAGE_ERRORS = {
  unavailable: 'Browser storage is not available, so designs will not be kept after closing this page. Export them to a file.',
  quota: 'Browser storage is full. Export your designs to a file and delete some to keep saving.',
  recovered: 'Some saved designs could not be read. A backup copy of the old data is kept in this browser.',
  damaged:
    'Saved designs could not be read and there is no room for a backup copy, so changes are not saved. Export your designs to a file.',
  newerVersion: 'Your designs were saved by a newer version of SquareMath. Reload the page: changes made here are not saved.',
} as const;

export type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export interface SyncSnapshot {
  /** Display order: most recently updated first at load; edits keep their place during a session. */
  designs: Design[];
  storageError: string | null;
}

function storageErrorMessage(e: unknown): string {
  const name = e instanceof DOMException ? e.name : '';
  return name === 'QuotaExceededError' || name === 'NS_ERROR_DOM_QUOTA_REACHED'
    ? STORAGE_ERRORS.quota
    : STORAGE_ERRORS.unavailable;
}

function isBlank(text: string): boolean {
  return text.trim() === '';
}

export class LibrarySync {
  private library: Library = EMPTY_LIBRARY;
  private timer: ReturnType<typeof setTimeout> | null = null;
  /** Never write again in this session (newer-version data, or damaged data that could not be backed up). */
  private readOnly = false;
  /** Loaded from LEGACY_STORAGE_KEY: remove that key after the first successful write. */
  private legacy = false;
  /** The text this tab last wrote (its own write needs no re-parse). */
  private lastWritten: string | null = null;
  /** The damaged text already backed up in this session. */
  private backedUp: string | null = null;
  private writeError: string | null = null;
  private notice: string | null = null;
  private snapshot: SyncSnapshot;
  private readonly listeners = new Set<() => void>();
  private readonly getStorage: () => StorageLike;
  private readonly delayMs: number;

  /** `getStorage` may throw (SecurityError in locked-down browsers). */
  constructor(getStorage: () => StorageLike, delayMs = PERSIST_DELAY_MS) {
    this.getStorage = getStorage;
    this.delayMs = delayMs;
    this.load();
    this.snapshot = this.makeSnapshot();
  }

  // --- reading -------------------------------------------------------------------------------

  get designs(): Design[] {
    return this.library.designs;
  }

  get deleted(): Library['deleted'] {
    return this.library.deleted;
  }

  getSnapshot = (): SyncSnapshot => this.snapshot;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  // --- changing --------------------------------------------------------------------------------

  /** Replace the library in memory and schedule a write. */
  commit(next: Library): void {
    this.library = next;
    this.emit();
    this.schedule();
  }

  /** Write now if a write is pending. Call when the page is hidden or unloaded. */
  flush = (): void => {
    if (this.timer === null) return;
    clearTimeout(this.timer);
    this.timer = null;
    if (this.readOnly) return;
    try {
      const storage = this.getStorage();
      const stored = storage.getItem(STORAGE_KEY);
      if (stored !== null && stored !== this.lastWritten) {
        const read = parseStoredLibrary(stored);
        if (!this.protect(storage, stored, read)) return;
        if (read.status === 'ok') this.adopt(mergeLibraries(this.library, { designs: dedupeSorted(read.designs), deleted: read.deleted }));
      }
      const text = storedLibraryToJson(this.library.designs, this.library.deleted);
      storage.setItem(STORAGE_KEY, text);
      this.lastWritten = text;
      if (this.legacy) {
        storage.removeItem(LEGACY_STORAGE_KEY);
        this.legacy = false;
      }
      this.setWriteError(null);
    } catch (e) {
      this.setWriteError(storageErrorMessage(e));
    }
  };

  /** Another tab changed storage (the window 'storage' event). */
  receive(key: string | null, newValue: string | null): void {
    if (key !== null && key !== STORAGE_KEY) return;
    if (newValue === null) {
      // Storage cleared or the library removed in another tab: follow it.
      if (this.timer !== null) clearTimeout(this.timer);
      this.timer = null;
      this.lastWritten = null;
      this.adopt(EMPTY_LIBRARY);
      return;
    }
    this.mergeFrom(newValue);
  }

  /** Re-read storage, e.g. when a frozen or background page becomes visible again (events may be missed). */
  syncFromStorage = (): void => {
    let text: string | null;
    try {
      text = this.getStorage().getItem(STORAGE_KEY);
    } catch {
      return;
    }
    if (text !== null) this.mergeFrom(text);
  };

  // --- internals -------------------------------------------------------------------------------

  private load(): void {
    let storage: StorageLike;
    let text: string | null;
    try {
      storage = this.getStorage();
      text = storage.getItem(STORAGE_KEY);
      if (text === null) {
        text = storage.getItem(LEGACY_STORAGE_KEY);
        this.legacy = text !== null;
      }
    } catch (e) {
      this.writeError = storageErrorMessage(e);
      return;
    }
    if (text === null) return;
    const read = parseStoredLibrary(text);
    if (read.status !== 'unreadable') {
      // Merging into an empty library sorts, applies and prunes the stored tombstones.
      const stored = { designs: dedupeSorted(read.designs), deleted: read.status === 'ok' ? read.deleted : [] };
      this.library = mergeLibraries(EMPTY_LIBRARY, stored);
    }
    if (!this.protect(storage, text, read)) return;
    const damaged = read.status === 'unreadable' || (read.status === 'ok' && read.invalid > 0);
    if (this.legacy || damaged) this.schedule(); // migrate / repair right away
  }

  /** Before stored `text` may be overwritten: back it up when it holds data that could not be fully
   * read. Returns false, and stops all writes, when overwriting is not safe. */
  private protect(storage: StorageLike, text: string, read: StoredLibrary): boolean {
    if (read.status === 'newer') {
      this.enterReadOnly(STORAGE_ERRORS.newerVersion);
      return false;
    }
    const damaged = read.status === 'unreadable' ? !isBlank(text) : read.invalid > 0;
    if (!damaged || text === this.backedUp) return true;
    try {
      storage.setItem(`${BACKUP_KEY_PREFIX}${Date.now()}`, text);
      this.backedUp = text;
      this.setNotice(STORAGE_ERRORS.recovered);
      return true;
    } catch {
      this.enterReadOnly(STORAGE_ERRORS.damaged);
      return false;
    }
  }

  private mergeFrom(text: string): void {
    if (text === this.lastWritten) return;
    const read = parseStoredLibrary(text);
    if (read.status === 'newer') {
      this.enterReadOnly(STORAGE_ERRORS.newerVersion);
      return;
    }
    if (read.status !== 'ok') return; // the next write backs it up first
    const incoming = { designs: dedupeSorted(read.designs), deleted: read.deleted };
    const merged = mergeLibraries(this.library, incoming);
    this.adopt(merged);
    // Storage lacks something this tab has (a pending edit, or the other tab missed it): write it back.
    if (!sameVersions(merged.designs, incoming.designs) && this.timer === null) this.schedule();
  }

  /** Take a merged library; listeners hear about it only when the visible list changed. */
  private adopt(next: Library): void {
    const before = this.library.designs;
    this.library = next;
    const changed = next.designs.length !== before.length || next.designs.some((d, i) => d !== before[i]);
    if (changed) this.emit();
  }

  private schedule(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = setTimeout(this.flush, this.delayMs);
  }

  private enterReadOnly(notice: string): void {
    this.readOnly = true;
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    this.setNotice(notice);
  }

  private setNotice(notice: string): void {
    if (this.notice === notice) return;
    this.notice = notice;
    this.emit();
  }

  private setWriteError(error: string | null): void {
    if (this.writeError === error) return;
    this.writeError = error;
    this.emit();
  }

  private makeSnapshot(): SyncSnapshot {
    return { designs: this.library.designs, storageError: this.writeError ?? this.notice };
  }

  private emit(): void {
    // Called from the constructor (via load → protect) before `snapshot` exists: nothing listens yet.
    this.snapshot = this.makeSnapshot();
    for (const listener of this.listeners) listener();
  }
}
