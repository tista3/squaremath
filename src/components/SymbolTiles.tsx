// Simple-mode symbols as little boxes, like the squares on the sheet.
import { isPictogram, type PictogramId } from '../core/symbols';
import { t } from '../i18n';
import { getPictogram, PICTO_BOX, pictogramPath } from '../render/pictograms';

/** About one pixel at icon size; the sheet's thinner line would vanish on screen. */
const ICON_STROKE = 1.2;

/** What to read out for a symbol; numbers and letters read as themselves. */
export function symbolName(symbol: string): string {
  if (!symbol) return t('symbols.empty');
  return isPictogram(symbol) ? t(`symbols.${symbol}`) : symbol;
}

function PictogramIcon({ id }: { id: PictogramId }) {
  const { line, dots } = getPictogram(id);
  return (
    <svg className="pictogram" viewBox={`-1 -1 ${PICTO_BOX + 2} ${PICTO_BOX + 2}`} aria-hidden="true" focusable="false">
      <path
        d={pictogramPath(line)}
        fill="none"
        stroke="currentColor"
        strokeWidth={ICON_STROKE}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d={pictogramPath(dots)} fill="currentColor" />
    </svg>
  );
}

/** Boxes for `symbols` ('' = empty box), read out as their names. */
export function SymbolTiles({ symbols }: { symbols: readonly string[] }) {
  return (
    <span className="symbol-tiles">
      <span className="visually-hidden">{symbols.map(symbolName).join(', ')}</span>
      {symbols.map((symbol, i) => (
        <span key={i} className="symbol-tile" aria-hidden="true">
          {isPictogram(symbol) ? <PictogramIcon id={symbol} /> : symbol}
        </span>
      ))}
    </span>
  );
}
