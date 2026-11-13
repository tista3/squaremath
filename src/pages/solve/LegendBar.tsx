import { Icon } from '../../components/Icon';
import { t } from '../../i18n';
import type { LegendItem } from '../puzzle/legend';

/** Selected painting tool: a colour id, or null for the eraser. */
export type Tool = string | null;

/** Colour buttons (scrolling when there are many) with the eraser pinned after them, always in view. */
export function LegendBar({ items, tool, onSelect }: { items: LegendItem[]; tool: Tool; onSelect: (tool: Tool) => void }) {
  return (
    <div className="solve-legend hidden-print" role="toolbar" aria-label={t('solve.legend')}>
      <div className="solve-legend-colors">
        {items.map((item) => {
          const active = tool === item.colorId;
          return (
            <button
              key={item.colorId}
              type="button"
              className={`btn solve-legend-btn${active ? ' active' : ''}`}
              aria-pressed={active}
              title={t('solve.pickColor', { name: item.name, values: item.values })}
              onClick={() => onSelect(item.colorId)}
            >
              <span className="swatch" style={{ background: item.hex }} aria-hidden="true" />
              <span className="solve-legend-text">
                <span className="solve-legend-name">{item.name}</span>
                <span className="solve-legend-values">{item.values}</span>
              </span>
            </button>
          );
        })}
      </div>
      <button
        type="button"
        className={`btn solve-legend-btn solve-eraser${tool === null ? ' active' : ''}`}
        aria-pressed={tool === null}
        aria-label={t('solve.eraser')}
        title={t('solve.eraser')}
        onClick={() => onSelect(null)}
      >
        <Icon name="eraser" />
      </button>
    </div>
  );
}
