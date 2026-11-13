// Canvas view of the design grid. Fits the available space, supports zoom, and reports pointer strokes in
// cell coordinates. Two fingers pan the zoomed grid instead of drawing. Keyboard: the focused canvas shows a
// cursor box that the arrow keys move; Space/Enter applies the current tool, Shift+arrow paints while moving.
import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
  type RefObject,
} from 'react';
import type { PaletteColor } from '../../core/types';
import { t } from '../../i18n';
import { drawGrid } from './drawGrid';
import { cellAtClient, contentBoxOf, fitCellSize, moveCursor, type Cell } from './geometry';
import { useDevicePixelRatio } from './useDevicePixelRatio';

export interface StrokeHandlers {
  start(cell: Cell): void;
  /** null = pointer is outside the grid. */
  move(cell: Cell | null): void;
  end(): void;
  /** Abandon the stroke (e.g. a second finger turned it into a pan). */
  cancel(): void;
}

interface Props {
  cols: number;
  rows: number;
  cells: string[];
  palette: PaletteColor[];
  showGrid: boolean;
  /** Multiplier of the fitted cell size (1 = fit). */
  zoom: number;
  label: string;
  stroke: StrokeHandlers;
  /** Shown right under the canvas (e.g. the colour strip); its height is kept on screen too. */
  children?: ReactNode;
}

const BOTTOM_GAP = 16;
const MIN_HEIGHT = 240;
/** Left+right (top+bottom) border of .ed-canvas in CSS px. */
const CANVAS_BORDER = 4;

/** Elements laid out before `el` (previous siblings of it and of each ancestor): they decide where it starts. */
function elementsAbove(el: Element): Element[] {
  const out: Element[] = [];
  for (let node: Element | null = el; node && node !== document.body; node = node.parentElement) {
    for (let s = node.previousElementSibling; s; s = s.previousElementSibling) out.push(s);
  }
  return out;
}

/**
 * Width of the wrapper, and the viewport height left for the scrolling canvas box: from its top edge down to
 * the bottom of the screen, minus whatever the wrapper shows below it (the footer). Re-measured when the
 * window resizes and when anything above the canvas or inside the wrapper changes size (a header that wraps
 * after a rename, a tool row that expands, a hint that appears).
 */
function useAvailableBox(wrapRef: RefObject<HTMLDivElement | null>, scrollRef: RefObject<HTMLDivElement | null>) {
  const [box, setBox] = useState({ width: 0, height: 0 });
  useLayoutEffect(() => {
    const wrap = wrapRef.current;
    const scroll = scrollRef.current;
    if (!wrap || !scroll) return;
    const measure = () => {
      const scrollRect = scroll.getBoundingClientRect();
      const footer = Math.max(0, wrap.getBoundingClientRect().bottom - scrollRect.bottom);
      const top = scrollRect.top + window.scrollY;
      const width = wrap.clientWidth;
      const height = Math.max(MIN_HEIGHT, Math.floor(window.innerHeight - top - footer - BOTTOM_GAP));
      setBox((b) => (b.width === width && b.height === height ? b : { width, height }));
    };
    measure();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    for (const el of [wrap, document.body, ...elementsAbove(wrap)]) observer?.observe(el);
    window.addEventListener('resize', measure);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [wrapRef, scrollRef]);
  return box;
}

/** Focus came from the keyboard (Tab), not from a click or tap. */
function isFocusVisible(el: Element): boolean {
  try {
    return el.matches(':focus-visible');
  } catch {
    return false; // Selector unsupported: show the cursor on the first key press instead.
  }
}

export function GridCanvas({ cols, rows, cells, palette, showGrid, zoom, label, stroke, children }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const mode = useRef<'idle' | 'draw' | 'pan'>('idle');
  const [hover, setHover] = useState<Cell | null>(null);
  const [cursor, setCursor] = useState<Cell | null>(null);
  const [keyboardFocus, setKeyboardFocus] = useState(false);
  const box = useAvailableBox(wrapRef, scrollRef);
  const dpr = useDevicePixelRatio();
  const cellPx = box.width > 0 ? fitCellSize(box.width - CANVAS_BORDER, box.height - CANVAS_BORDER, cols, rows) * zoom : 0;
  const colors = useMemo(() => new Map(palette.map((c) => [c.id, c.hex])), [palette]);
  // A resize can leave the cursor outside the grid.
  const keyCell = cursor && cursor.x < cols && cursor.y < rows ? cursor : null;
  const highlight = hover ?? (keyboardFocus ? keyCell : null);

  useEffect(() => {
    if (canvasRef.current && cellPx > 0) {
      drawGrid(canvasRef.current, { cols, rows, cells, colors, cellPx, showGrid, hover: highlight, dpr });
    }
  }, [cols, rows, cells, colors, cellPx, showGrid, highlight, dpr]);

  // Keep the keyboard cursor visible inside a zoomed (scrolling) canvas.
  useEffect(() => {
    const canvas = canvasRef.current;
    const scroll = scrollRef.current;
    if (!keyboardFocus || !keyCell || !canvas || !scroll || cellPx <= 0) return;
    const c = contentBoxOf(canvas);
    const view = scroll.getBoundingClientRect();
    const left = c.left + keyCell.x * cellPx;
    const top = c.top + keyCell.y * cellPx;
    if (left < view.left) scroll.scrollLeft -= view.left - left;
    else if (left + cellPx > view.right) scroll.scrollLeft += left + cellPx - view.right;
    if (top < view.top) scroll.scrollTop -= view.top - top;
    else if (top + cellPx > view.bottom) scroll.scrollTop += top + cellPx - view.bottom;
  }, [keyboardFocus, keyCell, cellPx]);

  const hit = (e: PointerEvent<HTMLCanvasElement>): Cell | null =>
    cellAtClient(e.clientX, e.clientY, contentBoxOf(e.currentTarget), cols, rows);

  const sameCell = (a: Cell | null, b: Cell | null) => a?.x === b?.x && a?.y === b?.y;

  const onPointerDown = (e: PointerEvent<HTMLCanvasElement>) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    setKeyboardFocus(false);
    e.currentTarget.setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size > 1) {
      if (mode.current === 'draw') stroke.cancel();
      mode.current = 'pan';
      return;
    }
    const cell = hit(e);
    if (!cell) return;
    setCursor(cell);
    mode.current = 'draw';
    stroke.start(cell);
  };

  const onPointerMove = (e: PointerEvent<HTMLCanvasElement>) => {
    const cell = hit(e);
    if (e.pointerType === 'mouse') setHover((h) => (sameCell(h, cell) ? h : cell));
    const prev = pointers.current.get(e.pointerId);
    if (!prev) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (mode.current === 'draw') stroke.move(cell);
    else if (mode.current === 'pan' && scrollRef.current) {
      const n = pointers.current.size;
      scrollRef.current.scrollLeft -= (e.clientX - prev.x) / n;
      scrollRef.current.scrollTop -= (e.clientY - prev.y) / n;
    }
  };

  const onPointerUp = (e: PointerEvent<HTMLCanvasElement>) => {
    if (!pointers.current.delete(e.pointerId)) return;
    if (mode.current === 'draw') stroke.end();
    // A pan stays a pan until every finger is lifted, so the last finger never starts drawing.
    if (pointers.current.size === 0) mode.current = 'idle';
  };

  const onKeyDown = (e: KeyboardEvent<HTMLCanvasElement>) => {
    if (e.altKey || e.ctrlKey || e.metaKey || mode.current !== 'idle') return;
    const from = keyCell ?? { x: Math.floor(cols / 2), y: Math.floor(rows / 2) };
    setKeyboardFocus(true);
    if (e.key === ' ' || e.key === 'Enter') {
      e.preventDefault();
      if (e.repeat) return;
      setCursor(from);
      stroke.start(from);
      stroke.end();
      return;
    }
    const to = moveCursor(from, e.key, cols, rows);
    if (!to) return;
    e.preventDefault();
    setCursor(to);
    if (e.shiftKey) {
      stroke.start(from);
      stroke.move(to);
      stroke.end();
    }
  };

  const colorAt = keyCell ? palette.find((c) => c.id === cells[keyCell.y * cols + keyCell.x]) : undefined;
  const announcement =
    keyboardFocus && keyCell ? t('editor.cursorAt', { row: keyCell.y + 1, col: keyCell.x + 1, name: colorAt?.name ?? '' }) : '';

  return (
    <div ref={wrapRef} className="ed-canvas-wrap">
      <div ref={scrollRef} className="ed-canvas-scroll" style={{ maxHeight: box.height || undefined }}>
        <canvas
          ref={canvasRef}
          className="ed-canvas"
          role="application"
          aria-roledescription={t('editor.canvasRole')}
          aria-label={label}
          aria-describedby="ed-canvas-keys"
          tabIndex={0}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onPointerLeave={() => setHover(null)}
          onKeyDown={onKeyDown}
          onFocus={(e) => setKeyboardFocus(isFocusVisible(e.currentTarget))}
          onBlur={() => setKeyboardFocus(false)}
        />
      </div>
      <p id="ed-canvas-keys" className="visually-hidden">
        {t('editor.canvasKeys')}
      </p>
      <p className="visually-hidden" aria-live="polite">
        {announcement}
      </p>
      {children}
    </div>
  );
}
