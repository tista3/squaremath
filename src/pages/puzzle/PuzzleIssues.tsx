import { useMemo } from 'react';
import { Icon } from '../../components/Icon';
import { opSymbol } from '../../components/ui';
import { maxColorsFor, puzzleWarnings, randomSeed, type PuzzleWarning } from '../../core/puzzle';
import { ADD_SUB_LIMITS, MUL_DIV_LIMITS, type Design, type PuzzleSettings } from '../../core/types';
import { t } from '../../i18n';
import { sheetCellSizeMm, sheetPageCount, TILE_MIN_CELL_MM, type OkPuzzle } from '../../render/sheet';
import { duplicateColorNames } from './legend';
import { puzzleErrorMessage } from './messages';
import { ADD_SUB_PRESETS, MUL_DIV_PRESETS, quickFixes, usesAddSub, usesMulDiv, type QuickFix } from './settings';
import type { PuzzleOutcome } from './usePuzzleResult';

/** Below this printed cell size (mm) the expressions get hard to read (the sheet splits pages to stay above it). */
export const MIN_READABLE_CELL_MM = TILE_MIN_CELL_MM;

interface Props {
  design: Design;
  outcome: PuzzleOutcome;
  update: (updater: (d: Design) => Design) => void;
  /** Present for own designs: opens the editor (e.g. to shrink the grid). */
  onEditPicture?: () => void;
}

export function PuzzleIssues({ design, outcome, update, onEditPicture }: Props) {
  return (
    <>
      {!outcome.ok && <GenerationError design={design} outcome={outcome} update={update} />}
      {outcome.ok && <EngineWarnings design={design} puzzle={outcome} update={update} onEditPicture={onEditPicture} />}
      <SmallCellsWarning design={design} update={update} onEditPicture={onEditPicture} />
      <DuplicateNamesWarning design={design} onEditPicture={onEditPicture} />
    </>
  );
}

function GenerationError({ design, outcome, update }: Omit<Props, 'onEditPicture'>) {
  const error = outcome.ok ? null : outcome.error;
  const fixes = useMemo(() => {
    if (error?.code !== 'tooManyColors') return [];
    try {
      return quickFixes(design.puzzle, error.colorsUsed, maxColorsFor);
    } catch {
      return [];
    }
  }, [design.puzzle, error]);
  if (!error) return null;

  const applyFix = (settings: PuzzleSettings) => update((d) => ({ ...d, puzzle: settings }));
  const message = puzzleErrorMessage(error);
  return (
    <div className="error puzzle-issue" role="alert">
      <p className="row">
        <Icon name="warning" /> <span>{message}</span>
      </p>
      {fixes.length > 0 && (
        <div className="toolbar">
          {fixes.map((fix) => (
            <button key={fix.kind} type="button" className="btn" onClick={() => applyFix(fix.settings)}>
              {fixLabel(fix)}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function fixLabel(fix: QuickFix): string {
  switch (fix.kind) {
    case 'addSubMax':
      return t('puzzle.fixAddSub', { n: fix.value });
    case 'mulDivMax':
      return t('puzzle.fixMulDiv', { n: fix.value });
    case 'allOps':
      return t('puzzle.fixAllOps');
  }
}

function safeCellMm(design: Design): number | null {
  try {
    return sheetCellSizeMm(design);
  } catch {
    return null;
  }
}

function SmallCellsWarning({ design, update, onEditPicture }: Omit<Props, 'outcome'>) {
  const cellMm = safeCellMm(design);
  if (cellMm === null) return null;
  if (cellMm >= MIN_READABLE_CELL_MM) return <SplitPagesNote design={design} />;

  const landscape = { ...design, print: { ...design.print, orientation: 'landscape' as const } };
  const landscapeMm = design.print.orientation === 'landscape' ? null : safeCellMm(landscape);
  const landscapeHelps = landscapeMm !== null && landscapeMm > cellMm;
  return (
    <div className="warning puzzle-issue" role="status">
      <p className="row">
        <Icon name="info" />{' '}
        <span>{t(landscapeHelps ? 'puzzle.smallCells' : 'puzzle.smallCellsNoLandscape', { mm: cellMm.toFixed(1) })}</span>
      </p>
      {(landscapeHelps || onEditPicture) && (
        <div className="toolbar">
          {landscapeHelps && (
            <button type="button" className="btn" onClick={() => update((d) => ({ ...d, print: { ...d.print, orientation: 'landscape' } }))}>
              <span className="puzzle-orient landscape" aria-hidden="true" /> {t('puzzle.fixLandscape')}
            </button>
          )}
          {onEditPicture && (
            <button type="button" className="btn" onClick={onEditPicture}>
              <Icon name="resize" /> {t('puzzle.fixSmallerGrid')}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/** Two colours with the same name make the black & white key ambiguous; the key numbers them. */
function DuplicateNamesWarning({ design, onEditPicture }: Pick<Props, 'design' | 'onEditPicture'>) {
  const names = useMemo(() => duplicateColorNames(design), [design]);
  if (names.length === 0) return null;
  return (
    <div className="warning puzzle-issue" role="status">
      <p className="row">
        <Icon name="info" /> <span>{t('puzzle.duplicateNames', { names: names.map((n) => `"${n}"`).join(', ') })}</span>
      </p>
      {onEditPicture && (
        <div className="toolbar">
          <button type="button" className="btn" onClick={onEditPicture}>
            <Icon name="palette" /> {t('puzzle.fixRenameColors')}
          </button>
        </div>
      )}
    </div>
  );
}

function SplitPagesNote({ design }: { design: Design }) {
  let pages = 1;
  try {
    pages = sheetPageCount(design);
  } catch {
    return null;
  }
  if (pages <= 1) return null;
  return (
    <p className="muted row puzzle-issue-note" role="status">
      <Icon name="info" /> <span>{t('puzzle.splitPages', { n: pages })}</span>
    </p>
  );
}

/** The next preset above `current`, else the maximum, or null when already at the maximum. */
function nextAbove(presets: readonly number[], current: number, max: number): number | null {
  const next = [...presets, max].find((v) => v > current);
  return next === undefined ? null : next;
}

interface WarningProps {
  design: Design;
  puzzle: OkPuzzle;
  update: Props['update'];
  onEditPicture?: () => void;
}

/** Hints from the generator about dull or give-away sheets (only shown for extreme settings), in one block. */
function EngineWarnings({ design, puzzle, update, onEditPicture }: WarningProps) {
  const warnings = useMemo(() => {
    try {
      return puzzleWarnings(design, puzzle);
    } catch {
      return [];
    }
  }, [design, puzzle]);
  if (warnings.length === 0) return null;

  const s = design.puzzle;
  const setPuzzle = (patch: Partial<PuzzleSettings>) => update((d) => ({ ...d, puzzle: { ...d.puzzle, ...patch } }));
  const addSub = usesAddSub(s.ops) ? nextAbove(ADD_SUB_PRESETS, s.addSubMax, ADD_SUB_LIMITS.max) : null;
  const mulDiv = usesMulDiv(s.ops) ? nextAbove(MUL_DIV_PRESETS, s.mulDivMax, MUL_DIV_LIMITS.max) : null;
  const colorName = (id: string) => design.palette.find((c) => c.id === id)?.name ?? '?';
  const otherKey = s.legendMode === 'range' ? 'value' : 'range';
  const isVariety = (w: PuzzleWarning) => w.code === 'fewExpressions' || w.code === 'manyTrivial' || w.code === 'singleAnswerColor';
  const variety = warnings.some(isVariety);
  const balance = warnings.some((w) => !isVariety(w));
  const fewerColors = warnings.some((w) => w.code === 'fewExpressions' || w.code === 'singleAnswerColor');

  // Several one-answer colours read better as one sentence than as one warning each.
  const single = warnings.filter((w) => w.code === 'singleAnswerColor');
  const messages = warnings
    .filter((w) => w.code !== 'singleAnswerColor')
    .map((w) => warningText(w, colorName));
  if (single.length === 1) messages.push(warningText(single[0], colorName));
  else if (single.length > 1) {
    const names = single.map((w) => `"${colorName(w.colorId)}"`).join(', ');
    messages.push(t('puzzle.warnSingleAnswerColors', { colours: names }));
  }

  return (
    <div className="warning puzzle-issue" role="status">
      <p className="row">
        <Icon name="info" />
        {messages.length === 1 ? (
          <span>{messages[0]}</span>
        ) : (
          <span>
            <ul>
              {messages.map((m) => (
                <li key={m}>{m}</li>
              ))}
            </ul>
          </span>
        )}
      </p>
      <div className="toolbar">
        {variety && addSub !== null && (
          <button type="button" className="btn" onClick={() => setPuzzle({ addSubMax: addSub })}>
            {t('puzzle.fixAddSub', { n: addSub })}
          </button>
        )}
        {variety && mulDiv !== null && (
          <button type="button" className="btn" onClick={() => setPuzzle({ mulDivMax: mulDiv })}>
            {t('puzzle.fixMulDiv', { n: mulDiv })}
          </button>
        )}
        {fewerColors && onEditPicture && (
          <button type="button" className="btn" onClick={onEditPicture}>
            <Icon name="palette" /> {t('puzzle.fixFewerColors')}
          </button>
        )}
        {balance && (
          <>
            <button type="button" className="btn" onClick={() => setPuzzle({ seed: randomSeed() })}>
              <Icon name="dice" /> {t('puzzle.newPuzzle')}
            </button>
            <button type="button" className="btn" onClick={() => setPuzzle({ legendMode: otherKey })}>
              {t('puzzle.fixOtherKey')} ({otherKey === 'range' ? '1–10' : '3, 7, 12'})
            </button>
          </>
        )}
      </div>
    </div>
  );
}

function warningText(w: PuzzleWarning, colorName: (id: string) => string): string {
  switch (w.code) {
    case 'fewExpressions':
      return t('puzzle.warnFewExpressions', { distinct: w.distinct, cells: w.cells });
    case 'manyTrivial':
      return t('puzzle.warnManyTrivial', { trivial: w.trivial, cells: w.cells });
    case 'singleAnswerColor':
      return t('puzzle.warnSingleAnswerColor', { colour: colorName(w.colorId), cells: w.cells });
    case 'opImbalance':
      return t('puzzle.warnOpImbalance', { op: opSymbol(w.op), count: w.count, cells: w.cells });
    case 'opRevealsColor':
      return t('puzzle.warnOpRevealsColor', { op: opSymbol(w.op), colour: colorName(w.colorId) });
  }
}
