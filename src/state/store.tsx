// OWNER: core-data agent. LocalStorage-backed design library as React context (sync logic: librarySync.ts).
import { createContext, useContext, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import type { ReactNode } from 'react';
import { cleanName, cloneDesign, copyName, createBlankDesign } from '../core/design';
import type { Design } from '../core/types';
import { addTombstone, libraryCopy, mergeImported, names } from './library';
import { LibrarySync } from './librarySync';

export { STORAGE_ERRORS, STORAGE_KEY } from './librarySync';

export interface DesignStore {
  /** User's designs, most recently updated first. Exception: a renamed card keeps its place during the
   * session (it moves up at the next load), so it does not jump away while the child is looking at it. */
  designs: Design[];
  get(id: string): Design | undefined;
  /** Create a new blank design (opts as createBlankDesign), persist, return it. */
  create(opts?: { name?: string; width?: number; height?: number }): Design;
  /** Apply an updater, bump updatedAt, move the design to the front, persist. No-op if id unknown. */
  update(id: string, updater: (d: Design) => Design): void;
  /** Copy named with copyName(), persist, return the copy. */
  duplicate(id: string): Design | undefined;
  /** Like update() with a new (cleaned) name, but the design keeps its place in the list. */
  rename(id: string, name: string): void;
  remove(id: string): void;
  /** Persist a copy of an external design (template/shared link) with a new id; returns it. */
  saveCopy(d: Design): Design;
  /** Add designs from an imported file: new ones go first (renamed with copyName() on a name clash),
   * newer versions of existing designs replace them in place, same or older versions are skipped. */
  importDesigns(designs: Design[]): { added: number; updated: number; skipped: number };
  /** Non-null when localStorage is unavailable, full, or held data that could not be fully read or was
   * written by a newer version (UI shows a warning; see STORAGE_ERRORS). */
  storageError: string | null;
}

const StoreContext = createContext<DesignStore | null>(null);

type Ops = Omit<DesignStore, 'designs' | 'storageError'>;

function createOps(sync: LibrarySync): Ops {
  const commitDesigns = (designs: Design[]) => sync.commit({ designs, deleted: sync.deleted });
  const find = (id: string) => sync.designs.find((d) => d.id === id);
  const add = (d: Design) => {
    commitDesigns([d, ...sync.designs]);
    return d;
  };
  const apply = (id: string, updater: (d: Design) => Design, moveToFront: boolean) => {
    const current = find(id);
    if (!current) return;
    const changed = updater(current);
    if (changed === current) return;
    // updatedAt also decides which version wins when tabs or imported files are merged.
    const next = { ...changed, id, updatedAt: Math.max(Date.now(), current.updatedAt + 1) };
    const others = sync.designs.filter((d) => d.id !== id);
    commitDesigns(moveToFront ? [next, ...others] : sync.designs.map((d) => (d.id === id ? next : d)));
  };
  const update = (id: string, updater: (d: Design) => Design) => apply(id, updater, true);
  return {
    get: find,
    create: (opts) => add(createBlankDesign(opts)),
    update,
    duplicate: (id) => {
      const source = find(id);
      return source && add(cloneDesign(source, { name: copyName(source.name, names(sync.designs)) }));
    },
    rename: (id, name) => {
      const clean = cleanName(name);
      if (clean) apply(id, (d) => (d.name === clean ? d : { ...d, name: clean }), false);
    },
    remove: (id) => {
      const target = find(id);
      if (!target) return;
      sync.commit({ designs: sync.designs.filter((d) => d.id !== id), deleted: addTombstone(sync.deleted, target) });
    },
    saveCopy: (d) => add(libraryCopy(d, sync.designs)),
    importDesigns: (incoming) => {
      const { designs, added, updated, skipped } = mergeImported({ designs: sync.designs, deleted: sync.deleted }, incoming);
      if (added + updated > 0) commitDesigns(designs);
      return { added, updated, skipped };
    },
  };
}

export function DesignStoreProvider(props: { children: ReactNode }): ReactNode {
  const [sync] = useState(() => new LibrarySync(() => window.localStorage));
  const { designs, storageError } = useSyncExternalStore(sync.subscribe, sync.getSnapshot);
  const ops = useMemo(() => createOps(sync), [sync]);

  useEffect(() => {
    const onStorage = (e: StorageEvent) => sync.receive(e.key, e.newValue);
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') sync.flush();
      else sync.syncFromStorage();
    };
    const onPageShow = (e: PageTransitionEvent) => {
      if (e.persisted) sync.syncFromStorage(); // restored from the back/forward cache
    };
    window.addEventListener('storage', onStorage);
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', sync.flush);
    window.addEventListener('pageshow', onPageShow);
    return () => {
      window.removeEventListener('storage', onStorage);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', sync.flush);
      window.removeEventListener('pageshow', onPageShow);
      sync.flush();
    };
  }, [sync]);

  const value = useMemo<DesignStore>(() => ({ ...ops, designs, storageError }), [ops, designs, storageError]);
  return <StoreContext.Provider value={value}>{props.children}</StoreContext.Provider>;
}

export function useDesignStore(): DesignStore {
  const store = useContext(StoreContext);
  if (!store) throw new Error('useDesignStore must be used inside <DesignStoreProvider>');
  return store;
}
