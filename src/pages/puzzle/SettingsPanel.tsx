import { Icon } from '../../components/Icon';
import { SymbolTiles } from '../../components/SymbolTiles';
import { HARD_BLOCK_AREA, resolveBlocks, type BlockSettings } from '../../core/blocks';
import { randomSeed } from '../../core/puzzle';
import { DEFAULT_SIMPLE } from '../../core/symbols';
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
import { SimpleSettingsFields } from './SimpleSettingsFields';
import { ADD_SUB_PRESETS, MUL_DIV_PRESETS, toggleOp, usesAddSub, usesMulDiv } from './settings';
import type { PuzzleOutcome } from './usePuzzleResult';

interface Props {
  design: Design;
  /** The generated puzzle, for the number of blocks. */
  outcome: PuzzleOutcome;
  update: (updater: (d: Design) => Design) => void;
}

export function SettingsPanel({ design, outcome, update }: Props) {
  const setPuzzle = (patch: Partial<PuzzleSettings>) => update((d) => ({ ...d, puzzle: { ...d.puzzle, ...patch } }));
  const setPrint = (patch: Partial<PrintSettings>) => update((d) => ({ ...d, print: { ...d.print, ...patch } }));
  return (
    <section className="panel stack puzzle-settings" aria-label={t('puzzle.settings')}>
      <h2 className="puzzle-h2">{t('puzzle.puzzleTitle')}</h2>
      <PuzzleOptions design={design} outcome={outcome} setPuzzle={setPuzzle} />
      <h2 className="puzzle-h2">{t('puzzle.printTitle')}</h2>
      <PrintOptions print={design.print} simple={!!design.puzzle.simple?.on} setPrint={setPrint} />
    </section>
  );
}

/** Canonical glyphs: the toggles name operations; the printed × / ÷ style is chosen under Printing. */
const OP_GLYPHS: Record<Op, string> = { add: '+', sub: '−', mul: '×', div: '÷' };

type SetPuzzle = (p: Partial<PuzzleSettings>) => void;

function PuzzleOptions({ design, outcome, setPuzzle }: { design: Design; outcome: PuzzleOutcome; setPuzzle: SetPuzzle }) {
  const p = design.puzzle;
  const simple = p.simple ?? DEFAULT_SIMPLE;
  return (
    <>
      <Segmented
        className="puzzle-mode"
        label={t('puzzle.mode')}
        value={simple.on ? 'simple' : 'math'}
        onChange={(mode) => setPuzzle({ simple: { ...simple, on: mode === 'simple' } })}
        options={[
          {
            value: 'math',
            label: (
              <>
                <SymbolLabel text="2 + 3" /> {t('puzzle.modeMath')}
              </>
            ),
            title: t('puzzle.modeMathTitle'),
            ariaLabel: t('puzzle.modeMath'),
          },
          {
            value: 'simple',
            label: (
              <>
                <SymbolTiles symbols={['A', 'star']} /> {t('puzzle.modeSimple')}
              </>
            ),
            title: t('puzzle.modeSimpleTitle'),
            ariaLabel: t('puzzle.modeSimple'),
          },
        ]}
      />
      {simple.on ? (
        <SimpleSettingsFields value={simple} onChange={(next) => setPuzzle({ simple: next })} />
      ) : (
        <MathSettings settings={p} setPuzzle={setPuzzle} />
      )}
      <Toggle
        label={t('puzzle.blankBackground', { name: backgroundName(design) })}
        title={t('puzzle.blankBackgroundTitle')}
        checked={p.blankBackground}
        onChange={(blankBackground) => setPuzzle({ blankBackground })}
      />
      <BlockOptions design={design} outcome={outcome} simple={simple.on} setPuzzle={setPuzzle} />
      <button
        type="button"
        className="btn big puzzle-dice"
        title={t(simple.on ? 'puzzle.newSimpleTitle' : 'puzzle.newPuzzleTitle')}
        onClick={() => setPuzzle({ seed: randomSeed() })}
      >
        <Icon name="dice" /> {t('puzzle.newPuzzle')}
      </button>
    </>
  );
}

/** Joining squares into blocks; the sub-options only show while blocks are on. */
function BlockOptions({
  design,
  outcome,
  simple,
  setPuzzle,
}: {
  design: Design;
  outcome: PuzzleOutcome;
  /** Simple puzzles have no sums to make longer. */
  simple: boolean;
  setPuzzle: SetPuzzle;
}) {
  const blocks = resolveBlocks(design);
  // The first change stores all three settings, so a design keeps them when its size changes later.
  const set = (patch: Partial<BlockSettings>) => setPuzzle({ blocks: { ...blocks, ...patch } });
  const list = outcome.ok ? outcome.blocks : undefined;
  const squares = list?.reduce((sum, b) => sum + b.w * b.h, 0) ?? 0;
  return (
    <>
      <Toggle label={t('puzzle.blocks')} title={t('puzzle.blocksTitle')} checked={blocks.on} onChange={(on) => set({ on })} />
      {blocks.on && (
        <div className="puzzle-subtoggles">
          {list && <p className="muted puzzle-block-count">{t('puzzle.blocksCount', { squares, blocks: list.length })}</p>}
          <Toggle
            label={t('puzzle.hideOutline')}
            title={t('puzzle.hideOutlineTitle')}
            checked={blocks.hideOutline}
            onChange={(hideOutline) => set({ hideOutline })}
          />
          {!simple && (
            <Toggle
              label={t('puzzle.harderSums')}
              title={t('puzzle.harderSumsTitle', { n: HARD_BLOCK_AREA })}
              checked={blocks.harderSums}
              onChange={(harderSums) => set({ harderSums })}
            />
          )}
        </div>
      )}
    </>
  );
}

function MathSettings({ settings: p, setPuzzle }: { settings: PuzzleSettings; setPuzzle: SetPuzzle }) {
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
    </>
  );
}

function PrintOptions({
  print,
  simple,
  setPrint,
}: {
  print: PrintSettings;
  /** Simple puzzles print no sums, so there are no signs to choose. */
  simple: boolean;
  setPrint: (p: Partial<PrintSettings>) => void;
}) {
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
      {!simple && (
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
      )}
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

function backgroundName(design: Design): string {
  return design.palette.find((c) => c.id === design.backgroundId)?.name ?? '';
}

function Toggle({
  label,
  title,
  checked,
  onChange,
}: {
  label: string;
  title?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="puzzle-toggle" title={title}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="puzzle-toggle-track" aria-hidden="true" />
      <span>{label}</span>
    </label>
  );
}
