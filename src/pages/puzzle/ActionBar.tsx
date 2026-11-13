import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Icon, type IconName } from '../../components/Icon';
import { useToast } from '../../components/ui';
import type { Design } from '../../core/types';
import { downloadDesignPng, downloadPuzzlePdf, downloadPuzzlePng, printPuzzle } from '../../export';
import { t } from '../../i18n';
import { exportErrorMessage } from './messages';

type Job = 'print' | 'pdf' | 'png' | 'picture';

const JOBS: Record<Job, { icon: IconName; run: (d: Design) => Promise<void>; needsPuzzle: boolean }> = {
  print: { icon: 'print', run: printPuzzle, needsPuzzle: true },
  pdf: { icon: 'file', run: downloadPuzzlePdf, needsPuzzle: true },
  png: { icon: 'download', run: downloadPuzzlePng, needsPuzzle: true },
  picture: { icon: 'image', run: downloadDesignPng, needsPuzzle: false },
};

interface Props {
  design: Design;
  /** False when the puzzle cannot be generated: sheet exports and solving are disabled. */
  puzzleReady: boolean;
  onShare: () => void;
  onSolve: () => void;
}

export function ActionBar({ design, puzzleReady, onShare, onSolve }: Props) {
  const toast = useToast();
  const [busy, setBusy] = useState<Job | null>(null);

  const run = async (job: Job) => {
    setBusy(job);
    try {
      await JOBS[job].run(design);
    } catch (err) {
      console.error(`${job} failed`, err);
      toast(exportErrorMessage(err), 'error');
    } finally {
      setBusy(null);
    }
  };
  usePrintShortcut(puzzleReady ? () => busy === null && run('print') : null);

  return (
    <div className="toolbar puzzle-actions hidden-print" role="toolbar" aria-label={t('puzzle.actions')}>
      {(Object.keys(JOBS) as Job[]).map((job) => (
        <button
          key={job}
          type="button"
          className={`btn${job === 'print' ? ' primary' : ''}${busy === job ? ' puzzle-busy' : ''}`}
          disabled={busy !== null || (JOBS[job].needsPuzzle && !puzzleReady)}
          aria-busy={busy === job}
          title={t(`puzzle.action_${job}_title`)}
          onClick={() => run(job)}
        >
          <Icon name={JOBS[job].icon} /> <span>{t(`puzzle.action_${job}`)}</span>
        </button>
      ))}
      <button type="button" className="btn" title={t('puzzle.action_share_title')} onClick={onShare}>
        <Icon name="share" /> <span>{t('puzzle.action_share')}</span>
      </button>
      <span className="spacer" />
      <button type="button" className="btn primary big" disabled={!puzzleReady} title={t('puzzle.action_solve_title')} onClick={onSolve}>
        <Icon name="play" /> <span>{t('puzzle.action_solve')}</span>
      </button>
    </div>
  );
}

/**
 * Ctrl/Cmd+P prints the real puzzle sheet (page-sized, vector) instead of this settings page.
 * `print` is null while printing is not possible; the browser's own print then runs (see @media print).
 */
function usePrintShortcut(print: (() => void) | null) {
  const latest = useRef(print);
  useLayoutEffect(() => {
    latest.current = print;
  });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.shiftKey || e.altKey || e.key.toLowerCase() !== 'p' || !latest.current) return;
      e.preventDefault();
      latest.current();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}
