import { SymbolTiles } from '../../components/SymbolTiles';
import { PICTOGRAM_SETS, SYMBOL_SETS, SYMBOLS_PER_COLOR, type SimpleSettings, type SymbolSet } from '../../core/symbols';
import { t } from '../../i18n';
import { Field, Segmented } from './Segmented';

/** Sample symbols of each set, shown on its button and on the "how many per colour" buttons. */
const EXAMPLES: Record<SymbolSet, readonly string[]> = {
  numbers: ['1', '2', '3', '4'],
  upper: ['A', 'B', 'C', 'D'],
  lower: ['a', 'b', 'c', 'd'],
  shapes: PICTOGRAM_SETS.shapes.slice(0, 4),
  animals: PICTOGRAM_SETS.animals.slice(0, 4),
  nature: PICTOGRAM_SETS.nature.slice(0, 4),
  food: PICTOGRAM_SETS.food.slice(0, 4),
  vehicles: PICTOGRAM_SETS.vehicles.slice(0, 4),
  mixed: ['owl', 'flower', 'apple', 'rocket'],
};
const EXAMPLES_PER_SET = 3;

/** Choices of simple mode: which symbols, and how many of them mean the same colour. */
export function SimpleSettingsFields({ value, onChange }: { value: SimpleSettings; onChange: (next: SimpleSettings) => void }) {
  return (
    <>
      <Field label={t('puzzle.symbolSet')}>
        <div className="puzzle-sets" role="group" aria-label={t('puzzle.symbolSet')}>
          {SYMBOL_SETS.map((set) => (
            <button
              key={set}
              type="button"
              className={`btn puzzle-set${set === value.set ? ' active' : ''}`}
              aria-pressed={set === value.set}
              aria-label={t(`symbols.set_${set}`)}
              onClick={() => onChange({ ...value, set })}
            >
              <SymbolTiles symbols={EXAMPLES[set].slice(0, EXAMPLES_PER_SET)} />
              <span>{t(`symbols.set_${set}`)}</span>
            </button>
          ))}
        </div>
      </Field>
      <Field label={t('puzzle.perColor')}>
        <Segmented
          className="puzzle-per-color"
          label={t('puzzle.perColor')}
          value={String(value.perColor)}
          onChange={(picked) => onChange({ ...value, perColor: SYMBOLS_PER_COLOR.find((n) => String(n) === picked)! })}
          options={SYMBOLS_PER_COLOR.map((n) => ({
            value: String(n),
            label: <SymbolTiles symbols={EXAMPLES[value.set].slice(0, n)} />,
            title: t('puzzle.perColorTitle', { count: n }),
            ariaLabel: t('puzzle.perColorTitle', { count: n }),
          }))}
        />
      </Field>
    </>
  );
}
