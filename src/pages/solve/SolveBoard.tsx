import { useEffect, useMemo, useReducer, useState, type Dispatch } from 'react';
import { useNavigate } from 'react-router-dom';
import { Icon } from '../../components/Icon';
import { ConfirmDialog, IconButton } from '../../components/ui';
import { formatExpression } from '../../core/puzzle';
import type { Design } from '../../core/types';
import { printPuzzle } from '../../export';
import { t } from '../../i18n';
import type { OkPuzzle } from '../../render/sheet';
import { routes } from '../../routes';
import { loadProgress, progressKey, saveProgress } from '../../state/progress';
import { shouldIgnoreShortcut } from '../editor/tools';
import { DesignBackLink, DesignTabs, useShareDialog } from '../puzzle/DesignNav';
import { legendItems } from '../puzzle/legend';
import { exportErrorMessage } from '../puzzle/messages';
import { carriedState } from '../puzzle/settings';
import { Celebration } from './Celebration';
import { LegendBar, type Tool } from './LegendBar';
import { SolveCanvas, type BoardKeys, type StrokeHandlers } from './SolveCanvas';
import {
  countFilled,
  initialSolveState,
  isSolved,
  sanitizeProgress,
  solveReducer,
  wrongMask,
  type SolveAction,
  type SolveState,
} from './solveState';
import { useProgressPersistence } from './useProgressPersistence';

interface Props {
  design: Design;
  puzzle: OkPuzzle;
  /** progressKey(design); the board is remounted (keyed) when it changes. */
  storageKey: string;
  /** Route prefix of the design's pages ("/d/<id>" or "/s/<payload>"). */
  basePath: string;
  /** Shared design: settings stay local and there is no editor. */
  readOnly: boolean;
  /** Present for read-only shared designs. */
  onSaveCopy?: () => string;
}

export function SolveBoard({ design, puzzle, storageKey, basePath, readOnly, onSaveCopy }: Props) {
  const navigate = useNavigate();
  const share = useShareDialog(design);
  const items = useMemo(() => legendItems(design, puzzle.legend), [design, puzzle.legend]);
  const [state, dispatch] = useReducer(solveReducer, null, (): SolveState => {
    const allowed = new Set(puzzle.legend.map((e) => e.colorId));
    return initialSolveState(sanitizeProgress(loadProgress(storageKey), design.cells.length, allowed));
  });
  useProgressPersistence(storageKey, state.filled);

  const [tool, setTool] = useState<Tool>(items[0]?.colorId ?? null);
  const [check, setCheck] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const [printing, setPrinting] = useState(false);
  const [printError, setPrintError] = useState<string | null>(null);

  const solved = isSolved(state.filled, design.cells);
  // Celebrate when the picture gets finished here, not every time a finished one is reopened.
  const [celebrating, setCelebrating] = useState(false);
  const [wasSolved, setWasSolved] = useState(solved);
  if (solved !== wasSolved) {
    setWasSolved(solved);
    if (solved) setCelebrating(true);
  }

  const labels = useMemo(
    () => puzzle.expressions.map((e) => formatExpression(e, design.print)),
    [puzzle.expressions, design.print],
  );
  const hexById = useMemo(() => new Map(design.palette.map((c) => [c.id, c.hex])), [design.palette]);
  const nameById = useMemo(() => new Map(items.map((item) => [item.colorId, item.name])), [items]);
  const fills = useMemo(() => state.filled.map((id) => (id === null ? null : (hexById.get(id) ?? null))), [state.filled, hexById]);
  const wrong = useMemo(() => (check ? wrongMask(state.filled, design.cells) : null), [check, state.filled, design.cells]);
  const wrongCount = wrong ? wrong.filter(Boolean).length : 0;
  const checkResult = wrongCount ? t('solve.wrongCount', { n: wrongCount }) : t('solve.allGood');

  const stroke: StrokeHandlers = {
    start: () => dispatch({ type: 'strokeStart' }),
    paint: (cells) => dispatch({ type: 'paint', cells, value: tool }),
    end: () => dispatch({ type: 'strokeEnd' }),
    cancel: () => dispatch({ type: 'strokeCancel' }),
  };

  const keys: BoardKeys = {
    // Outside a stroke every paint is its own undo step.
    paintCell: (cell, erase) => dispatch({ type: 'paint', cells: [cell], value: erase ? null : tool }),
    pickSlot: (slot) => {
      if (slot === 0) setTool(null);
      else if (items[slot - 1]) setTool(items[slot - 1].colorId);
    },
    describeCell: (cell) => {
      const id = state.filled[cell];
      return t('solve.cellAnnounce', {
        row: Math.floor(cell / design.width) + 1,
        col: (cell % design.width) + 1,
        sum: labels[cell],
        colour: id === null ? t('solve.cellEmpty') : (nameById.get(id) ?? ''),
      });
    },
  };

  useUndoShortcut(dispatch);

  // Only the celebration prints, and it shows failures itself: a toast would sit under the modal dialog.
  const print = async () => {
    setPrinting(true);
    setPrintError(null);
    try {
      await printPuzzle(design);
    } catch (err) {
      console.error('printPuzzle failed', err);
      setPrintError(exportErrorMessage(err));
    } finally {
      setPrinting(false);
    }
  };

  const closeCelebration = () => {
    setCelebrating(false);
    setPrintError(null);
  };

  const saveCopy =
    onSaveCopy &&
    (() => {
      const id = onSaveCopy();
      // Carry the progress over to the saved copy (its key differs only by id).
      saveProgress(progressKey({ ...design, id }), state.filled);
      navigate(routes.design(id, 'solve'), { state: carriedState(design) });
    });

  return (
    <div className="solve-page">
      <div className="toolbar solve-toolbar">
        <DesignBackLink basePath={basePath} readOnly={readOnly} />
        <h1 className="solve-title">{design.name}</h1>
        <ProgressMeter done={countFilled(state.filled)} total={design.cells.length} />
        {solved && !celebrating && (
          <IconButton icon="star" label={t('solve.solvedAgain')} className="solve-solved" onClick={() => setCelebrating(true)} />
        )}
        <span className="spacer" />
        <IconButton icon="undo" label={t('solve.undo')} disabled={state.undo.length === 0} onClick={() => dispatch({ type: 'undo' })} />
        {/* No aria-label: the visible label plus the result badge form the button's name. */}
        <button
          type="button"
          className={`btn solve-check${check ? ' active' : ''}`}
          aria-pressed={check}
          title={t('solve.checkTitle')}
          onClick={() => setCheck((c) => !c)}
        >
          <Icon name="check" /> <span className="solve-btn-label">{t('solve.check')}</span>
          {check && <span className={`badge${wrongCount ? ' solve-wrong-badge' : ''}`}>{checkResult}</span>}
        </button>
        <IconButton icon="clear" label={t('solve.reset')} onClick={() => setConfirmReset(true)} />
        <IconButton icon="share" label={t('solve.share')} onClick={share.open} />
        <DesignTabs design={design} basePath={basePath} current="solve" readOnly={readOnly} compact />
        {saveCopy && (
          <button type="button" className="btn primary" title={t('common.saveToMyDesigns')} onClick={saveCopy}>
            <Icon name="save" /> <span className="solve-btn-label">{t('common.saveToMyDesignsShort')}</span>
          </button>
        )}
      </div>
      <p className="visually-hidden" aria-live="polite">
        {check ? checkResult : ''}
      </p>
      <div className="solve-main">
        <SolveCanvas
          cols={design.width}
          rows={design.height}
          labels={labels}
          fills={fills}
          wrong={wrong}
          ariaLabel={t('solve.boardLabel', { name: design.name })}
          stroke={stroke}
          keys={keys}
        />
        <LegendBar items={items} tool={tool} onSelect={setTool} />
      </div>
      <ConfirmDialog
        open={confirmReset}
        title={t('solve.resetTitle')}
        message={t('solve.resetMessage')}
        confirmLabel={t('solve.resetConfirm')}
        danger
        onConfirm={() => {
          dispatch({ type: 'reset' });
          setConfirmReset(false);
        }}
        onCancel={() => setConfirmReset(false)}
      />
      {celebrating && (
        <Celebration
          design={design}
          printing={printing}
          printError={printError}
          onClose={closeCelebration}
          onGallery={() => navigate(routes.gallery())}
          onPrint={print}
          onShare={() => {
            // One modal at a time: the share dialog replaces the celebration (the star brings it back).
            closeCelebration();
            share.open();
          }}
          onAgain={() => {
            dispatch({ type: 'restart' });
            closeCelebration();
          }}
        />
      )}
      {share.dialog}
    </div>
  );
}

function ProgressMeter({ done, total }: { done: number; total: number }) {
  const pct = total ? Math.round((done / total) * 100) : 0;
  return (
    <div
      className="solve-progress"
      role="progressbar"
      aria-label={t('solve.progress')}
      aria-valuemin={0}
      aria-valuemax={total}
      aria-valuenow={done}
      title={t('solve.progressTitle', { done, total })}
    >
      <span className="solve-progress-track">
        <span className="solve-progress-fill" style={{ width: `${pct}%` }} />
      </span>
      <span className="solve-progress-text">
        {done} / {total}
      </span>
    </div>
  );
}

/** Ctrl/Cmd+Z undoes the last stroke (ignored while typing in a field). */
function useUndoShortcut(dispatch: Dispatch<SolveAction>) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.shiftKey || e.key.toLowerCase() !== 'z') return;
      if (shouldIgnoreShortcut(e)) return;
      e.preventDefault();
      dispatch({ type: 'undo' });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [dispatch]);
}
