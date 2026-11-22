import { SymbolTiles } from '../../components/SymbolTiles';
import type { Design, LegendEntry } from '../../core/types';
import { t } from '../../i18n';
import { legendItems } from './legend';

export function LegendSummary({ design, legend }: { design: Design; legend: LegendEntry[] }) {
  const items = legendItems(design, legend);
  return (
    <div className="stack">
      <h3 className="puzzle-h3">{t(items.length === 1 ? 'puzzle.legendTitleOne' : 'puzzle.legendTitle', { count: items.length })}</h3>
      <ul className="puzzle-legend">
        {items.map((item) => (
          <li key={item.colorId}>
            <span className="swatch" style={{ background: item.hex }} aria-hidden="true" />
            <span className="puzzle-legend-name">{item.name}</span>
            <span className="puzzle-legend-values">{item.symbols ? <SymbolTiles symbols={item.symbols} /> : item.values}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
