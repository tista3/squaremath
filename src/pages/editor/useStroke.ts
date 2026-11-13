// Turns canvas strokes into edits for the active tool. Pencil/eraser strokes are kept as a local draft
// (drawn immediately) and committed once on pointer-up, so a whole stroke is a single undo step.
import { useRef, useState } from 'react';
import type { Design } from '../../core/types';
import { bresenhamLine, floodFill, paintCells, type Cell } from './geometry';
import type { StrokeHandlers } from './GridCanvas';
import type { Tool } from './tools';

interface Options {
  design: Design;
  tool: Tool;
  /** Selected palette colour (pencil / fill). */
  colorId: string;
  commitCells(cells: string[]): void;
  /** Picker result. */
  pick(colorId: string): void;
}

export function useStroke({ design, tool, colorId, commitCells, pick }: Options): { draft: string[] | null; handlers: StrokeHandlers } {
  const [draft, setDraft] = useState<string[] | null>(null);
  const draftRef = useRef<string[] | null>(null);
  const lastRef = useRef<Cell | null>(null);
  const { width, height, cells } = design;
  const paintId = tool === 'eraser' ? design.backgroundId : colorId;

  const setDraftCells = (next: string[] | null) => {
    draftRef.current = next;
    setDraft(next);
  };

  const reset = () => {
    lastRef.current = null;
    setDraftCells(null);
  };

  const handlers: StrokeHandlers = {
    start(cell) {
      if (tool === 'picker') return pick(cells[cell.y * width + cell.x]);
      if (tool === 'fill') return commitCells(floodFill(cells, width, height, cell, colorId));
      lastRef.current = cell;
      setDraftCells(paintCells(cells, [cell], width, paintId));
    },
    move(cell) {
      const current = draftRef.current;
      if (!current) return;
      if (!cell) {
        lastRef.current = null;
        return;
      }
      const points = lastRef.current ? bresenhamLine(lastRef.current, cell) : [cell];
      lastRef.current = cell;
      const next = paintCells(current, points, width, paintId);
      if (next !== current) setDraftCells(next);
    },
    end() {
      const finished = draftRef.current;
      reset();
      if (finished && finished !== cells) commitCells(finished);
    },
    cancel: reset,
  };

  return { draft, handlers };
}
