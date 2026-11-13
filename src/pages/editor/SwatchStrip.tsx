// Compact, horizontally scrolling row of colour swatches shown right under the canvas on phones and tablets,
// so a child can switch colours without scrolling away from the picture. The full palette editor (rename,
// recolour, add, delete) stays in PalettePanel; on wide screens the strip is hidden (CSS) and the panel's own
// swatch grid is used instead.
import { useEffect, useRef } from 'react';
import { Icon } from '../../components/Icon';
import { textColorFor } from '../../core/colors';
import type { Design } from '../../core/types';
import { t } from '../../i18n';
import { countCells } from './palette';

interface Props {
  design: Design;
  selectedId: string;
  onSelect(colorId: string): void;
}

export function SwatchStrip({ design, selectedId, onSelect }: Props) {
  const counts = countCells(design.cells);
  const ref = useRef<HTMLDivElement>(null);

  // Keep the selected colour in view (e.g. after a number shortcut or adding a colour). Only the strip
  // scrolls sideways; the page itself is never scrolled.
  useEffect(() => {
    const strip = ref.current;
    const btn = strip?.querySelector<HTMLElement>('[aria-pressed="true"]');
    if (!strip || !btn) return;
    const s = strip.getBoundingClientRect();
    const b = btn.getBoundingClientRect();
    if (b.left < s.left) strip.scrollLeft -= s.left - b.left;
    else if (b.right > s.right) strip.scrollLeft += b.right - s.right;
  }, [selectedId]);

  return (
    <div ref={ref} className="ed-strip" role="group" aria-label={t('editor.palette')}>
      {design.palette.map((c) => {
        const selected = c.id === selectedId;
        const label = t('editor.selectColor', { name: c.name, count: counts.get(c.id) ?? 0 });
        return (
          <button
            key={c.id}
            type="button"
            className={selected ? 'ed-strip-btn selected' : 'ed-strip-btn'}
            style={{ background: c.hex, color: textColorFor(c.hex) }}
            aria-pressed={selected}
            aria-label={label}
            title={label}
            onClick={() => onSelect(c.id)}
          >
            {c.id === design.backgroundId && <Icon name="star" size={16} />}
          </button>
        );
      })}
    </div>
  );
}
