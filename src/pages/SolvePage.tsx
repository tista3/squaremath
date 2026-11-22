// OWNER: puzzle-solve agent. Interactive on-screen solving/colouring.
import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Icon } from '../components/Icon';
import { t } from '../i18n';
import { routes } from '../routes';
import { progressKey } from '../state/progress';
import { carriedState } from './puzzle/settings';
import { useEffectiveDesign } from './puzzle/useEffectiveDesign';
import { usePuzzleResult, type PuzzleOutcome } from './puzzle/usePuzzleResult';
import { SolveBoard } from './solve/SolveBoard';
import type { DesignPageProps } from './types';
import './SolvePage.css';

export default function SolvePage(props: DesignPageProps) {
  const { design, readOnly } = useEffectiveDesign(props);
  const outcome = usePuzzleResult(design);
  const key = useMemo(() => progressKey(design), [design]);
  const navigate = useNavigate();

  if (!outcome.ok) {
    const openSettings = () =>
      navigate(routes.sub(props.basePath, 'puzzle'), readOnly ? { state: carriedState(design) } : undefined);
    return <SolveUnavailable outcome={outcome} onOpenSettings={openSettings} />;
  }
  return (
    <SolveBoard
      key={key}
      design={design}
      puzzle={outcome}
      storageKey={key}
      basePath={props.basePath}
      readOnly={readOnly}
      onSaveCopy={props.onSaveCopy}
    />
  );
}

function SolveUnavailable({ outcome, onOpenSettings }: { outcome: Extract<PuzzleOutcome, { ok: false }>; onOpenSettings: () => void }) {
  const { error } = outcome;
  const message =
    error.code === 'tooManyColors'
      ? t('solve.cannotSolveColors', { used: error.colorsUsed, available: error.resultsAvailable })
      : error.code === 'tooFewSymbols'
        ? t('solve.cannotSolveSymbols', { used: error.colorsUsed, available: error.symbolsAvailable })
        : t('solve.cannotSolve');
  return (
    <div className="page">
      <div className="panel stack solve-unavailable" role="alert">
        <Icon name="warning" size={48} />
        <h1>{t('solve.cannotSolveTitle')}</h1>
        <p>{message}</p>
        <button type="button" className="btn primary big" onClick={onOpenSettings}>
          <Icon name="settings" /> {t('solve.openSettings')}
        </button>
      </div>
    </div>
  );
}
