// OWNER: puzzle-solve agent. Puzzle settings + live sheet preview + print / PDF / PNG / share.
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Icon } from '../components/Icon';
import { t } from '../i18n';
import { routes } from '../routes';
import { ActionBar } from './puzzle/ActionBar';
import { DesignBackLink, DesignTabs, useShareDialog } from './puzzle/DesignNav';
import { LegendSummary } from './puzzle/LegendSummary';
import { PuzzleIssues } from './puzzle/PuzzleIssues';
import { Segmented } from './puzzle/Segmented';
import { carriedState } from './puzzle/settings';
import { SettingsPanel } from './puzzle/SettingsPanel';
import { SheetPreview, type SheetKind } from './puzzle/SheetPreview';
import { useEffectiveDesign } from './puzzle/useEffectiveDesign';
import { usePuzzleResult } from './puzzle/usePuzzleResult';
import type { DesignPageProps } from './types';
import './PuzzlePage.css';

export default function PuzzlePage(props: DesignPageProps) {
  const { basePath, onSaveCopy } = props;
  const { design, update, readOnly } = useEffectiveDesign(props);
  const outcome = usePuzzleResult(design);
  const navigate = useNavigate();
  const [kind, setKind] = useState<SheetKind>('puzzle');
  const share = useShareDialog(design);
  // Shared designs aren't persisted, so local settings travel along in the router state.
  const goSolve = () => navigate(routes.sub(basePath, 'solve'), readOnly ? { state: carriedState(design) } : undefined);
  const saveCopy = onSaveCopy && (() => navigate(routes.design(onSaveCopy(), 'puzzle'), { state: carriedState(design) }));
  const editPicture = readOnly ? undefined : () => navigate(routes.sub(basePath, 'edit'));

  return (
    <div className="page puzzle-page">
      <div className="page-header">
        <DesignBackLink basePath={basePath} readOnly={readOnly} />
        <h1 className="puzzle-title">{design.name}</h1>
        <span className="spacer" />
        <DesignTabs design={design} basePath={basePath} current="puzzle" readOnly={readOnly} />
        {saveCopy && (
          <button type="button" className="btn primary" title={t('common.saveToMyDesigns')} onClick={saveCopy}>
            <Icon name="save" /> {t('common.saveToMyDesigns')}
          </button>
        )}
      </div>
      {readOnly && <p className="muted">{t('puzzle.sharedNote')}</p>}
      <ActionBar design={design} puzzleReady={outcome.ok} onShare={share.open} onSolve={goSolve} />
      <div className="puzzle-layout">
        <SettingsPanel design={design} outcome={outcome} update={update} />
        <section className="panel stack puzzle-preview" aria-label={t('puzzle.preview')}>
          <Segmented
            label={t('puzzle.preview')}
            value={kind}
            onChange={setKind}
            options={[
              { value: 'puzzle', label: <><Icon name="puzzle" /> {t('puzzle.tabPuzzle')}</> },
              { value: 'solution', label: <><Icon name="eye" /> {t('puzzle.tabSolution')}</> },
            ]}
          />
          <PuzzleIssues design={design} outcome={outcome} update={update} onEditPicture={editPicture} />
          {outcome.ok && (
            <>
              <SheetPreview design={design} puzzle={outcome} kind={kind} />
              <LegendSummary design={design} legend={outcome.legend} />
            </>
          )}
        </section>
      </div>
      {share.dialog}
    </div>
  );
}
