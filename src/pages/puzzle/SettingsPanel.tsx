import { Icon } from '../../components/Icon';
import { randomSeed } from '../../core/puzzle';
import {
  ADD_SUB_LIMITS,
  ALL_OPS,
  MUL_DIV_LIMITS,
  type Design,
  type Op,
  type PrintSettings,
  type PuzzleSettings,
} from '../../core/types';
import { t } from '../../i18n';
import { LimitPicker } from './LimitPicker';
import { Field, Segmented } from './Segmented';
import { ADD_SUB_PRESETS, MUL_DIV_PRESETS, toggleOp, usesAddSub, usesMulDiv } from './settings';

interface Props {
  design: Design;
  update: (updater: (d: Design) => Design) => void;
}

export function SettingsPanel({ design, update }: Props) {
  const setPuzzle = (patch: Partial<PuzzleSettings>) => update((d) => ({ ...d, puzzle: { ...d.puzzle, ...patch } }));
  const setPrint = (patch: Partial<PrintSettings>) => update((d) => ({ ...d, print: { ...d.print, ...patch } }));
  return (
    <section className="panel stack puzzle-settings" aria-label={t('puzzle.settings')}>
      <h2 className="puzzle-h2">{t('puzzle.mathTitle')}</h2>
      <MathSettings design={design} setPuzzle={setPuzzle} />
      <h2 className="puzzle-h2">{t('puzzle.printTitle')}</h2>
      <PrintOptions print={design.print} setPrint={setPrint} />
    </section>
  );
}

/** Canonical glyphs: the toggles name operations; the printed × / ÷ style is chosen under Printing. */
const OP_GLYPHS: Record<Op, string> = { add: '+', sub: '−', mul: '×', div: '÷' };

function MathSettings({ design, setPuzzle }: { design: Design; setPuzzle: (p: Partial<PuzzleSettings>) => void }) {
  const p = design.puzzle;
  return (
    <>
      <Field label={t('puzzle.operations')}>
        <div className="puzzle-ops" role="group" aria-label={t('puzzle.operations')}>
          {ALL_OPS.map((op) => {
            const on = p.ops.includes(op);
            const isLast = on && p.ops.length === 1;
            return (
              <button
                key={op}
                type="button"
                className={`btn big puzzle-op${on ? ' active' : ''}`}
                aria-pressed={on}
                aria-label={t(`puzzle.op_${op}`)}
                title={isLast ? t('puzzle.opLast') : t(`puzzle.op_${op}`)}
                onClick={() => setPuzzle({ ops: toggleOp(p.ops, op) })}
              >
                {OP_GLYPHS[op]}
              </button>
            );
          })}
        </div>
      </Field>
      {usesAddSub(p.ops) && (
        <LimitPicker
          label={t('puzzle.addSubMax')}
          value={p.addSubMax}
          presets={ADD_SUB_PRESETS}
          limits={ADD_SUB_LIMITS}
          onChange={(addSubMax) => setPuzzle({ addSubMax })}
        />
      )}
      {usesMulDiv(p.ops) && (
        <LimitPicker
          label={t('puzzle.mulDivMax')}
          value={p.mulDivMax}
          presets={MUL_DIV_PRESETS}
          limits={MUL_DIV_LIMITS}
          onChange={(mulDivMax) => setPuzzle({ mulDivMax })}
        />
      )}
      <Field label={t('puzzle.legendMode')}>
        <Segmented
          label={t('puzzle.legendMode')}
          value={p.legendMode}
          onChange={(legendMode) => setPuzzle({ legendMode })}
          options={[
            {
              value: 'range',
              label: <SymbolLabel text="1–10" />,
              title: t('puzzle.legendRangeTitle'),
              ariaLabel: t('puzzle.legendRange'),
            },
            {
              value: 'value',
              label: <SymbolLabel text="3, 7, 12" />,
              title: t('puzzle.legendValueTitle'),
              ariaLabel: t('puzzle.legendValue'),
            },
          ]}
        />
      </Field>
      <button type="button" className="btn big puzzle-dice" title={t('puzzle.newPuzzleTitle')} onClick={() => setPuzzle({ seed: randomSeed() })}>
        <Icon name="dice" /> {t('puzzle.newPuzzle')}
      </button>
    </>
  );
}

function PrintOptions({ print, setPrint }: { print: PrintSettings; setPrint: (p: Partial<PrintSettings>) => void }) {
  return (
    <>
      <Field label={t('puzzle.paper')}>
        <Segmented
          label={t('puzzle.paper')}
          value={print.paper}
          onChange={(paper) => setPrint({ paper })}
          options={[
            { value: 'A4', label: 'A4' },
            { value: 'Letter', label: t('puzzle.paperLetter') },
          ]}
        />
      </Field>
      <Field label={t('puzzle.orientation')}>
        <Segmented
          label={t('puzzle.orientation')}
          value={print.orientation}
          onChange={(orientation) => setPrint({ orientation })}
          options={[
            {
              value: 'auto',
              label: (
                <span className="puzzle-orient-auto" aria-hidden="true">
                  <span className="puzzle-orient portrait" />
                  <span className="puzzle-orient landscape" />
                </span>
              ),
              title: t('puzzle.orientAutoTitle'),
              ariaLabel: t('puzzle.orientAuto'),
            },
            {
              value: 'portrait',
              label: <span className="puzzle-orient portrait" aria-hidden="true" />,
              title: t('puzzle.orientPortrait'),
              ariaLabel: t('puzzle.orientPortrait'),
            },
            {
              value: 'landscape',
              label: <span className="puzzle-orient landscape" aria-hidden="true" />,
              title: t('puzzle.orientLandscape'),
              ariaLabel: t('puzzle.orientLandscape'),
            },
          ]}
        />
      </Field>
      <div className="puzzle-symbols">
        <Field label={t('puzzle.divSymbol')}>
          <Segmented
            label={t('puzzle.divSymbol')}
            value={print.divSymbol}
            onChange={(divSymbol) => setPrint({ divSymbol })}
            options={[
              { value: '÷', label: '÷' },
              { value: ':', label: ':' },
            ]}
          />
        </Field>
        <Field label={t('puzzle.mulSymbol')}>
          <Segmented
            label={t('puzzle.mulSymbol')}
            value={print.mulSymbol}
            onChange={(mulSymbol) => setPrint({ mulSymbol })}
            options={[
              { value: '×', label: '×' },
              { value: '·', label: '·' },
            ]}
          />
        </Field>
      </div>
      <Toggle label={t('puzzle.showTitle')} checked={print.showTitle} onChange={(showTitle) => setPrint({ showTitle })} />
      <Toggle label={t('puzzle.includeSolution')} checked={print.includeSolution} onChange={(includeSolution) => setPrint({ includeSolution })} />
      <Toggle label={t('puzzle.legendSwatches')} checked={print.legendSwatches} onChange={(legendSwatches) => setPrint({ legendSwatches })} />
    </>
  );
}

/** Symbol-only button label: the example numbers show the idea; the title explains it in words. */
function SymbolLabel({ text }: { text: string }) {
  return <span className="puzzle-symbol-label">{text}</span>;
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="puzzle-toggle">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="puzzle-toggle-track" aria-hidden="true" />
      <span>{label}</span>
    </label>
  );
}
