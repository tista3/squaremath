// Zoomable, scrollable canvas board. One finger / mouse paints (drag paints a line of cells);
// two fingers pan and pinch-zoom; Ctrl+wheel zooms. Only the visible cells are drawn, on a
// viewport-sized canvas that stays put (position: sticky) while the content scrolls underneath.
// Keyboard: the board is focusable; arrows move a cursor cell, Space/Enter paints, Backspace/Delete
// erases, digits pick a colour (0 = eraser), + / − zoom. A live region reads out the cursor cell.
import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { Icon } from '../../components/Icon';
import { useDevicePixelRatio } from '../editor/useDevicePixelRatio';
import { t } from '../../i18n';
import { createTextCache, drawBoard, type TextCache } from './drawBoard';
import {
  boardLayout,
  cellAtPoint,
  cellIndexes,
  clampCellPx,
  fitCellPx,
  initialCellPx,
  lineCells,
  moveCursor,
  revealScroll,
  zoomInsets,
  type CellPos,
} from './geometry';

export interface StrokeHandlers {
  start: () => void;
  paint: (cells: number[]) => void;
  end: () => void;
  cancel: () => void;
}

/** Keyboard actions on the board, handled by the owner (which knows the tools and colours). */
export interface BoardKeys {
  /** Paint one cell with the current tool, or erase it. */
  paintCell: (cell: number, erase: boolean) => void;
  /** Digit key: 0 = eraser, 1–9 = legend colour. */
  pickSlot: (slot: number) => void;
  /** Text read out for the cursor cell (expression and colour). */
  describeCell: (cell: number) => string;
}

interface Props {
  cols: number;
  rows: number;
  labels: string[];
  fills: (string | null)[];
  wrong: boolean[] | null;
  ariaLabel: string;
  stroke: StrokeHandlers;
  keys: BoardKeys;
}

interface Point {
  x: number;
  y: number;
}

/** Pinch/pan gesture start: the grid point (in cells) under the fingers' midpoint stays under it. */
interface Gesture {
  dist0: number;
  px0: number;
  gridX: number;
  gridY: number;
}

const ZOOM_STEP = 1.25;
/** Space kept around the keyboard cursor when scrolling it into view. */
const REVEAL_MARGIN = 8;

export function SolveCanvas({ cols, rows, labels, fills, wrong, ariaLabel, stroke, keys }: Props) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const text = useRef<TextCache>(createTextCache());
  const pointers = useRef(new Map<number, Point>());
  const lastCell = useRef<CellPos | null>(null);
  const gesture = useRef<Gesture | null>(null);
  const pendingScroll = useRef<Point | null>(null);
  const revealCursor = useRef(false);
  const frame = useRef(0);
  const helpId = useId();
  // State, so a DPR change (other monitor, browser zoom) re-renders and the board redraws crisply.
  const dpr = useDevicePixelRatio();
  const [view, setView] = useState({ w: 0, h: 0 });
  const [zoom, setZoom] = useState<number | null>(null);
  const [cursor, setCursor] = useState<CellPos | null>(null);
  /** The cursor is shown only while the board has focus and the keyboard is in use. */
  const [keyboard, setKeyboard] = useState(false);

  const insets = zoomInsets(view.w, view.h);
  const dock = insets.right > 0 ? 'right' : 'bottom';
  const layoutFor = (cellPx: number) => boardLayout(view.w, view.h, cols, rows, cellPx, insets);
  const px = zoom ?? (view.w > 0 ? initialCellPx(view.w, view.h, cols, rows, insets) : null);
  const layout = px === null ? null : layoutFor(px);
  const shownCursor = keyboard ? cursor : null;

  useLayoutEffect(() => {
    const el = scrollerRef.current!;
    const measure = () => setView({ w: el.clientWidth, h: el.clientHeight });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const draw = () => {
    const canvas = canvasRef.current;
    const el = scrollerRef.current;
    if (!canvas || !el || px === null || !layout) return;
    const frameData = {
      viewW: view.w,
      viewH: view.h,
      dpr,
      scrollX: el.scrollLeft,
      scrollY: el.scrollTop,
      layout,
      cellPx: px,
    };
    drawBoard(canvas, { ...frameData, cols, rows, labels, fills, wrong, cursor: shownCursor }, text.current);
  };

  const scheduleDraw = () => {
    if (frame.current) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = 0;
      drawRef.current();
    });
  };

  /** Viewport point (relative to the board's top-left) of a client coordinate. */
  const toView = (clientX: number, clientY: number): Point => {
    const rect = scrollerRef.current!.getBoundingClientRect();
    return { x: clientX - rect.left, y: clientY - rect.top };
  };

  /** Grid position (in cells, fractional) under a viewport point. */
  const gridPointAt = (p: Point, cellPx: number) => {
    const el = scrollerRef.current!;
    const l = layoutFor(cellPx);
    return { x: (el.scrollLeft + p.x - l.ox) / cellPx, y: (el.scrollTop + p.y - l.oy) / cellPx };
  };

  /** Applies a zoom so that grid point `grid` ends up under viewport point `anchor`. */
  const zoomAround = (next: number, grid: Point, anchor: Point) => {
    const target = clampCellPx(next);
    const l = layoutFor(target);
    const scroll = { x: grid.x * target + l.ox - anchor.x, y: grid.y * target + l.oy - anchor.y };
    if (target === px) {
      const el = scrollerRef.current!;
      el.scrollLeft = scroll.x;
      el.scrollTop = scroll.y;
    } else {
      pendingScroll.current = scroll;
      setZoom(target);
    }
  };

  const zoomBy = (factor: number, anchor: Point = { x: (view.w - insets.right) / 2, y: (view.h - insets.bottom) / 2 }) => {
    if (px === null) return;
    zoomAround(px * factor, gridPointAt(anchor, px), anchor);
  };

  const zoomToFit = () => {
    pendingScroll.current = { x: 0, y: 0 };
    setZoom(fitCellPx(view.w, view.h, cols, rows, insets));
  };

  /** Scrolls so the cursor cell sits clear of the board edges and the zoom buttons. */
  const scrollCursorIntoView = (el: HTMLDivElement, at: CellPos) => {
    if (px === null || !layout) return;
    el.scrollLeft = revealScroll(el.scrollLeft, view.w - insets.right, layout.ox + at.c * px, px, REVEAL_MARGIN);
    el.scrollTop = revealScroll(el.scrollTop, view.h - insets.bottom, layout.oy + at.r * px, px, REVEAL_MARGIN);
  };

  // Latest closures for callbacks that outlive a render (rAF, native wheel listener).
  const drawRef = useRef(draw);
  const wheelZoomRef = useRef((_e: WheelEvent) => {});
  useLayoutEffect(() => {
    drawRef.current = draw;
    wheelZoomRef.current = (e) => zoomBy(e.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP, toView(e.clientX, e.clientY));
    const el = scrollerRef.current!;
    const target = pendingScroll.current;
    if (target) {
      pendingScroll.current = null;
      el.scrollLeft = target.x;
      el.scrollTop = target.y;
    }
    if (revealCursor.current && shownCursor) {
      revealCursor.current = false;
      scrollCursorIntoView(el, shownCursor);
    }
    draw();
  });

  useEffect(() => {
    const el = scrollerRef.current!;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      wheelZoomRef.current(e);
    };
    // Non-passive listener: React's onWheel cannot preventDefault the browser's page zoom.
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      el.removeEventListener('wheel', onWheel);
      cancelAnimationFrame(frame.current);
    };
  }, []);

  const paintTo = (p: Point) => {
    if (px === null || !layout) return;
    const el = scrollerRef.current!;
    const cell = cellAtPoint(el.scrollLeft + p.x - layout.ox, el.scrollTop + p.y - layout.oy, px);
    const from = lastCell.current ?? cell;
    lastCell.current = cell;
    const indexes = cellIndexes(lineCells(from, cell), cols, rows);
    if (indexes.length) stroke.paint(indexes);
  };

  const startGesture = () => {
    const [a, b] = [...pointers.current.values()];
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    const grid = gridPointAt(mid, px!);
    gesture.current = { dist0: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)), px0: px!, gridX: grid.x, gridY: grid.y };
  };

  const moveGesture = (g: Gesture) => {
    const [a, b] = [...pointers.current.values()];
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    const scale = Math.hypot(a.x - b.x, a.y - b.y) / g.dist0;
    zoomAround(g.px0 * scale, { x: g.gridX, y: g.gridY }, mid);
  };

  const onPointerDown = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    if (px === null || (e.pointerType === 'mouse' && e.button !== 0)) return;
    setKeyboard(false);
    e.currentTarget.setPointerCapture(e.pointerId);
    const p = toView(e.clientX, e.clientY);
    pointers.current.set(e.pointerId, p);
    if (pointers.current.size === 1) {
      lastCell.current = null;
      stroke.start();
      paintTo(p);
    } else if (pointers.current.size === 2) {
      if (lastCell.current) stroke.cancel();
      lastCell.current = null;
      startGesture();
    }
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!pointers.current.has(e.pointerId)) return;
    const p = toView(e.clientX, e.clientY);
    pointers.current.set(e.pointerId, p);
    if (gesture.current && pointers.current.size >= 2) moveGesture(gesture.current);
    else if (lastCell.current) paintTo(p);
  };

  const onPointerEnd = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!pointers.current.delete(e.pointerId)) return;
    if (pointers.current.size < 2) gesture.current = null;
    if (pointers.current.size === 0 && lastCell.current) {
      lastCell.current = null;
      if (e.type === 'pointercancel') stroke.cancel();
      else stroke.end();
    }
  };

  /** Cursor to start from: the last one, else the first cell visible at the top-left. */
  const startCursor = (): CellPos => {
    if (cursor) return cursor;
    const el = scrollerRef.current;
    if (!el || px === null || !layout) return { c: 0, r: 0 };
    const c = Math.ceil((el.scrollLeft - layout.ox) / px);
    const r = Math.ceil((el.scrollTop - layout.oy) / px);
    return { c: Math.min(cols - 1, Math.max(0, c)), r: Math.min(rows - 1, Math.max(0, r)) };
  };

  const onKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.ctrlKey || e.metaKey || e.altKey || px === null) return;
    const at = startCursor();
    const index = at.r * cols + at.c;
    const moved = moveCursor(at, e.key, cols, rows);
    let handled = true;
    if (moved) {
      setCursor(moved);
    } else if (e.key === ' ' || e.key === 'Enter' || e.key === 'Backspace' || e.key === 'Delete') {
      keys.paintCell(index, e.key === 'Backspace' || e.key === 'Delete');
      setCursor(at);
    } else if (/^[0-9]$/.test(e.key)) {
      keys.pickSlot(Number(e.key));
    } else if (e.key === '+' || e.key === '=') {
      zoomBy(ZOOM_STEP);
    } else if (e.key === '-') {
      zoomBy(1 / ZOOM_STEP);
    } else {
      handled = false;
    }
    if (!handled) return;
    e.preventDefault();
    // Keep the cursor in view after moving or zooming.
    revealCursor.current = true;
    setKeyboard(true);
  };

  const cursorIndex = shownCursor ? shownCursor.r * cols + shownCursor.c : null;

  return (
    <div className="solve-board">
      <div
        ref={scrollerRef}
        className="solve-scroller"
        tabIndex={0}
        role="application"
        aria-label={ariaLabel}
        aria-describedby={helpId}
        onScroll={scheduleDraw}
        onKeyDown={onKeyDown}
        onFocus={(e) => {
          // Keyboard focus (Tab) shows the cursor straight away; a tap or click does not.
          if (e.target === e.currentTarget && isFocusVisible(e.currentTarget)) {
            setCursor(startCursor());
            setKeyboard(true);
          }
        }}
        onBlur={() => setKeyboard(false)}
      >
        <div className="solve-content" style={layout ? { width: layout.contentW, height: layout.contentH } : undefined}>
          <canvas
            ref={canvasRef}
            className="solve-canvas"
            style={{ width: view.w, height: view.h }}
            aria-hidden="true"
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerEnd}
            onPointerCancel={onPointerEnd}
            onContextMenu={(e) => e.preventDefault()}
          />
        </div>
      </div>
      <p id={helpId} className="visually-hidden">
        {t('solve.keysHelp')}
      </p>
      <p className="visually-hidden" aria-live="polite" aria-atomic="true">
        {cursorIndex !== null ? keys.describeCell(cursorIndex) : ''}
      </p>
      <div className={`solve-zoom dock-${dock} hidden-print`}>
        <button type="button" className="btn icon" aria-label={t('solve.zoomIn')} title={t('solve.zoomIn')} onClick={() => zoomBy(ZOOM_STEP)}>
          <Icon name="zoomIn" />
        </button>
        <button type="button" className="btn icon" aria-label={t('solve.zoomOut')} title={t('solve.zoomOut')} onClick={() => zoomBy(1 / ZOOM_STEP)}>
          <Icon name="zoomOut" />
        </button>
        <button type="button" className="btn icon" aria-label={t('solve.zoomFit')} title={t('solve.zoomFit')} onClick={zoomToFit}>
          <Icon name="fit" />
        </button>
      </div>
    </div>
  );
}

function isFocusVisible(el: Element): boolean {
  try {
    return el.matches(':focus-visible');
  } catch {
    return false; // selector unsupported: wait for the first key press
  }
}
