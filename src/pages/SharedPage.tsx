// OWNER: shell agent. Landing page for a shared link (/s/:payload).
import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { usedColorIds } from '../core/design';
import type { Design } from '../core/types';
import { t } from '../i18n';
import { Icon } from '../components/Icon';
import { findCopyOf } from '../components/library';
import { DesignPicture, PuzzleBadge, useToast } from '../components/ui';
import { routes } from '../routes';
import { useDesignStore } from '../state/store';
import './SharedPage.css';

export default function SharedPage({ design, payload }: { design: Design; payload: string }) {
  const store = useDesignStore();
  const toast = useToast();
  const navigate = useNavigate();
  // Hidden by default: the picture is the puzzle's solution.
  const [showPicture, setShowPicture] = useState(false);
  const basePath = routes.shared(payload);
  const simple = design.puzzle.simple?.on ? design.puzzle.simple : null;
  const colours = useMemo(() => {
    const used = new Set(usedColorIds(design));
    return design.palette.filter((c) => used.has(c.id));
  }, [design]);
  const myCopy = useMemo(() => findCopyOf(store.designs, design), [store.designs, design]);

  const saveCopy = () => {
    const copy = store.saveCopy(design);
    toast(t('shared.saved', { name: copy.name }), 'success');
    navigate(routes.design(copy.id, 'edit'));
  };

  return (
    <div className="page shared-page">
      <div className="shared-layout">
        <section className="panel stack shared-info" aria-labelledby="shared-title">
          <p className="shared-kicker muted">
            <Icon name="link" size={20} />
            {t('shared.kicker')}
          </p>
          <h1 id="shared-title">{design.name}</h1>
          <dl className="shared-facts">
            <div>
              <dt>{t('shared.size')}</dt>
              <dd>
                {design.width}×{design.height}
              </dd>
            </div>
            <div>
              <dt>{t(simple ? 'shared.simple' : 'shared.operations')}</dt>
              <dd>
                <PuzzleBadge puzzle={design.puzzle} />
              </dd>
            </div>
            <div>
              <dt>{t(simple ? 'shared.perColor' : 'shared.legend')}</dt>
              <dd>{simple ? simple.perColor : t(design.puzzle.legendMode === 'range' ? 'shared.legendRange' : 'shared.legendValue')}</dd>
            </div>
          </dl>
          <div className="stack shared-colours">
            <span className="shared-label">{t('shared.colours', { count: colours.length })}</span>
            <ul className="shared-chips">
              {colours.map((c) => (
                <li key={c.id}>
                  <span className="swatch" style={{ background: c.hex }} aria-hidden="true" />
                  {c.name}
                </li>
              ))}
            </ul>
          </div>
          <div className="stack shared-actions">
            <Link to={routes.sub(basePath, 'solve')} className="btn primary big">
              <Icon name="play" />
              {t('shared.solve')}
            </Link>
            <Link to={routes.sub(basePath, 'puzzle')} className="btn big">
              <Icon name="print" />
              {t('shared.print')}
            </Link>
            {myCopy ? (
              <>
                <Link to={routes.design(myCopy.id, 'edit')} className="btn big">
                  <Icon name="pencil" />
                  {t('common.openMyCopy')}
                </Link>
                <button type="button" className="btn ghost" onClick={saveCopy}>
                  <Icon name="copy" />
                  {t('shared.saveAnother')}
                </button>
              </>
            ) : (
              <button type="button" className="btn big" onClick={saveCopy}>
                <Icon name="save" />
                {t('common.saveToMyDesigns')}
              </button>
            )}
          </div>
        </section>

        <section className="panel stack shared-preview" aria-label={t('shared.picture')}>
          <div className="shared-frame">
            {showPicture ? (
              <DesignPicture design={design} maxPx={480} />
            ) : (
              <div className="shared-secret">
                <span className="shared-secret-mark" aria-hidden="true">
                  ?
                </span>
                <p className="muted">{t('shared.secret')}</p>
              </div>
            )}
          </div>
          <button
            type="button"
            className="btn"
            aria-pressed={showPicture}
            onClick={() => setShowPicture((v) => !v)}
          >
            <Icon name="eye" />
            {showPicture ? t('shared.hidePicture') : t('shared.showPicture')}
          </button>
        </section>
      </div>
    </div>
  );
}
