import { useEffect, useRef } from 'react';
import { clearProgress, saveProgress } from '../../state/progress';
import type { Fill } from './solveState';

const SAVE_DELAY_MS = 400;

function persist(key: string, filled: Fill[]) {
  if (filled.every((f) => f === null)) clearProgress(key);
  else saveProgress(key, filled);
}

/** Debounced save of solving progress; flushes on unmount and when the page is hidden/closed. */
export function useProgressPersistence(key: string, filled: Fill[]): void {
  const pending = useRef<{ key: string; filled: Fill[] } | null>(null);

  useEffect(() => {
    pending.current = { key, filled };
    const timer = setTimeout(flushPending, SAVE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [key, filled]);

  useEffect(() => {
    window.addEventListener('pagehide', flushPending);
    return () => {
      window.removeEventListener('pagehide', flushPending);
      flushPending();
    };
  }, []);

  function flushPending() {
    if (!pending.current) return;
    persist(pending.current.key, pending.current.filled);
    pending.current = null;
  }
}
