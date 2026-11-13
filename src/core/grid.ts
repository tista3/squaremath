// Shared grid helpers (pure): line rasteriser for strokes, grid size presets and clamping.
import { GRID_MAX, GRID_MIN } from './types';

export interface GridPoint {
  x: number;
  y: number;
}

/** All cells on the line from `from` to `to` (both inclusive), Bresenham's algorithm. */
export function lineCells(from: GridPoint, to: GridPoint): GridPoint[] {
  const out: GridPoint[] = [];
  const dx = Math.abs(to.x - from.x);
  const dy = -Math.abs(to.y - from.y);
  const sx = from.x < to.x ? 1 : -1;
  const sy = from.y < to.y ? 1 : -1;
  let err = dx + dy;
  let { x, y } = from;
  for (;;) {
    out.push({ x, y });
    if (x === to.x && y === to.y) return out;
    const e2 = 2 * err;
    if (e2 >= dy) {
      err += dy;
      x += sx;
    }
    if (e2 <= dx) {
      err += dx;
      y += sy;
    }
  }
}

/** Square grid sizes offered as one-tap choices (new design, resize dialog). */
export const GRID_SIZE_PRESETS = [8, 10, 12, 16, 20, 24, 32, 40] as const;

/** A typed grid size rounded and clamped to GRID_MIN..GRID_MAX; empty or non-numeric input gives `fallback`. */
export function clampGridSize(raw: string | number, fallback: number): number {
  if (typeof raw === 'string' && raw.trim() === '') return fallback;
  const n = Math.round(Number(raw));
  return Number.isFinite(n) ? Math.min(GRID_MAX, Math.max(GRID_MIN, n)) : fallback;
}
