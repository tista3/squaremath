// OWNER: photo-ui agent. Step 2: the analysed photo (subject box, detection badges) and the preset cards.
import { Icon } from '../../components/Icon';
import { t } from '../../i18n';
import { ImageCanvas } from './canvas';
import { boxPercent, isWholeImage, presetHint, subjectBoxPercent } from './helpers';
import type { PhotoSource, PresetView } from './prepare';

export function PhotoLayouts({
  source,
  onPick,
  onAnotherPhoto,
  onAnotherFigure,
}: {
  source: PhotoSource;
  onPick: (view: PresetView) => void;
  onAnotherPhoto: () => void;
  /** Given when the picture came from a sheet of several drawings. */
  onAnotherFigure?: () => void;
}) {
  return (
    <>
      <AnalysisPanel source={source} onAnotherPhoto={onAnotherPhoto} onAnotherFigure={onAnotherFigure} />
      <section className="stack" aria-labelledby="photo-layouts-title">
        <h2 id="photo-layouts-title" tabIndex={-1} data-step-heading>
          {t('photo.layoutsTitle')}
        </h2>
        <p className="muted">{t('photo.layoutsHint')}</p>
        <ul className="photo-presets" role="list">
          {source.presets.map((view) => (
            <li key={view.preset.id}>
              <PresetCard view={view} onPick={() => onPick(view)} />
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}

function AnalysisPanel({
  source,
  onAnotherPhoto,
  onAnotherFigure,
}: {
  source: PhotoSource;
  onAnotherPhoto: () => void;
  onAnotherFigure?: () => void;
}) {
  const { analysis, sourceSize } = source;
  const { background, kind, grids } = analysis;
  const box = subjectBoxPercent(analysis);
  // A grid picture is copied cell by cell, so the subject box would only confuse: show the grids instead.
  const showBox = grids.length === 0 && !isWholeImage(analysis);
  const numbered = grids.length > 1;

  return (
    <section className="panel photo-analysis" aria-labelledby="photo-analysis-title">
      <div className="photo-original">
        <ImageCanvas image={analysis.image} label={t('photo.original')} />
        {showBox && (
          <div
            className="photo-subject"
            style={{ left: `${box.left}%`, top: `${box.top}%`, width: `${box.width}%`, height: `${box.height}%` }}
            aria-hidden="true"
          />
        )}
        {grids.map((grid, i) => {
          const g = boxPercent(grid.box, sourceSize);
          return (
            <div
              key={i}
              className="photo-grid-box"
              style={{ left: `${g.left}%`, top: `${g.top}%`, width: `${g.width}%`, height: `${g.height}%` }}
              aria-hidden="true"
            >
              {numbered && <span className="photo-grid-number">{i + 1}</span>}
            </div>
          );
        })}
      </div>
      <div className="stack photo-analysis-text">
        <h2 id="photo-analysis-title">{t('photo.original')}</h2>
        <ul className="photo-facts" role="list">
          {grids.length === 1 && (
            <li className="badge photo-grid-badge" title={t('photo.gridFoundHint')}>
              <Icon name="grid" size={18} />
              {t('photo.gridFound', { cols: grids[0].cols, rows: grids[0].rows })}
            </li>
          )}
          {numbered && (
            <li className="badge photo-grid-badge" title={t('photo.gridFoundHint')}>
              <Icon name="grid" size={18} />
              {t('photo.gridsFound', { count: grids.length })}
            </li>
          )}
          {numbered &&
            grids.map((grid, i) => (
              <li key={i} className="badge">
                {t('photo.gridItem', { n: i + 1, cols: grid.cols, rows: grid.rows })}
              </li>
            ))}
          <li className="badge" title={t(`photo.kindHint_${kind}`)}>
            <Icon name={kind === 'photo' ? 'image' : 'pencil'} size={18} />
            {t(`photo.kind_${kind}`)}
            <span className="visually-hidden">: {t(`photo.kindHint_${kind}`)}</span>
          </li>
          {background ? (
            <li className="badge" title={t('photo.backgroundFoundHint', { hex: background })}>
              <span className="photo-swatch" style={{ background }} aria-hidden="true" />
              {t('photo.backgroundFound')}
              <span className="visually-hidden">: {t('photo.backgroundFoundHint', { hex: background })}</span>
            </li>
          ) : (
            <li className="badge" title={t('photo.backgroundNoneHint')}>
              <Icon name="eye" size={18} />
              {t('photo.backgroundNone')}
              <span className="visually-hidden">: {t('photo.backgroundNoneHint')}</span>
            </li>
          )}
          <li className="badge" title={t('photo.suggestedColoursHint')}>
            <Icon name="palette" size={18} />
            {t('photo.suggestedColours', { count: analysis.suggestedColors })}
          </li>
        </ul>
        {showBox && <p className="muted photo-note">{t('photo.subjectNote')}</p>}
        {grids.length > 0 && <p className="muted photo-note">{t(numbered ? 'photo.gridsNote' : 'photo.gridNote')}</p>}
        <div className="toolbar">
          {onAnotherFigure && (
            <button type="button" className="btn photo-another-figure" onClick={onAnotherFigure}>
              <Icon name="back" />
              {t('photo.anotherFigure')}
            </button>
          )}
          <button type="button" className="btn" onClick={onAnotherPhoto}>
            <Icon name="refresh" />
            {t('photo.anotherPhoto')}
          </button>
        </div>
      </div>
    </section>
  );
}

function PresetCard({ view, onPick }: { view: PresetView; onPick: () => void }) {
  const { conversion, label, thumb } = view;
  const hint = presetHint(view.preset.id);
  const colours = conversion.palette.length - (conversion.backgroundRemoved ? 1 : 0);
  return (
    <button type="button" className="card photo-preset" onClick={onPick} title={t('photo.pickHint')}>
      <span className="photo-preset-thumb">
        <img src={thumb} alt="" draggable={false} />
      </span>
      <span className="photo-preset-label">{label}</span>
      {hint && <span className="muted photo-preset-hint">{hint}</span>}
      <span className="photo-preset-meta">
        <span className="badge" title={t('photo.size')}>
          <Icon name="grid" size={16} />
          <span className="visually-hidden">{t('photo.size')}: </span>
          {conversion.width}×{conversion.height}
        </span>
        <span className="badge" title={t('photo.colourCount')}>
          <Icon name="palette" size={16} />
          <span className="visually-hidden">{t('photo.colourCount')}: </span>
          {colours}
        </span>
      </span>
    </button>
  );
}
