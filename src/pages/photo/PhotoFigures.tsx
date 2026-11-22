// OWNER: photo-ui agent. Step 2 for a sheet of many drawings: pick one, on the sheet or from the list.
import { useMemo } from 'react';
import { cutFigure, figureRegion } from '../../core/image/figures';
import { Icon } from '../../components/Icon';
import { t } from '../../i18n';
import { ImageCanvas } from './canvas';
import { boxPercent } from './helpers';
import type { PhotoSheet } from './prepare';

export function PhotoFigures({
  sheet,
  lastPicked,
  onPick,
  onWhole,
  onAnotherPhoto,
}: {
  sheet: PhotoSheet;
  /** The figure picked before coming back here: marked, and focused instead of the heading. */
  lastPicked?: number;
  onPick: (index: number) => void;
  onWhole: () => void;
  onAnotherPhoto: () => void;
}) {
  const { image, found } = sheet;
  const { figures } = found;
  const thumbs = useMemo(
    () => found.figures.map((figure) => cutFigure(figureRegion(image, figure), found, figure)),
    [image, found],
  );
  // Small boxes on top, so that a figure inside a bigger one's box can still be tapped.
  const onSheet = useMemo(
    () =>
      found.figures
        .map((figure, index) => ({ box: figure.box, index }))
        .sort((a, b) => b.box.w * b.box.h - a.box.w * a.box.h),
    [found],
  );

  return (
    <>
      <section className="panel stack photo-sheet" aria-labelledby="photo-figures-title">
        <h2 id="photo-figures-title" tabIndex={-1} data-step-heading>
          {t('photo.figuresTitle', { count: figures.length })}
        </h2>
        <p className="muted">{t('photo.figuresHint')}</p>
        <div className="toolbar">
          <button type="button" className="btn photo-use-whole" onClick={onWhole}>
            <Icon name="image" />
            {t('photo.figuresWhole')}
          </button>
          <button type="button" className="btn" onClick={onAnotherPhoto}>
            <Icon name="refresh" />
            {t('photo.anotherPhoto')}
          </button>
        </div>
        {/* A shortcut for pointers: the list below has the same figures as proper buttons. */}
        <div
          className="photo-sheet-map"
          style={{ aspectRatio: `${image.width} / ${image.height}`, maxWidth: `calc(60vh * ${image.width / image.height})` }}
          aria-hidden="true"
        >
          <ImageCanvas image={image} label={t('photo.original')} className="photo-sheet-canvas" />
          {onSheet.map(({ box, index }) => {
            const at = boxPercent(box, image);
            return (
              <button
                key={index}
                type="button"
                tabIndex={-1}
                className={`photo-sheet-box${index === lastPicked ? ' picked' : ''}`}
                title={t('photo.figureItem', { n: index + 1 })}
                style={{ left: `${at.left}%`, top: `${at.top}%`, width: `${at.width}%`, height: `${at.height}%` }}
                onClick={() => onPick(index)}
              />
            );
          })}
        </div>
      </section>

      <ul className="photo-figures" role="list" aria-label={t('photo.figuresList')}>
        {thumbs.map((thumb, index) => {
          const label = t('photo.figureItem', { n: index + 1 });
          return (
            <li key={index}>
              <button
                type="button"
                className={`photo-figure${index === lastPicked ? ' picked' : ''}`}
                aria-label={label}
                data-step-focus={index === lastPicked ? '' : undefined}
                onClick={() => onPick(index)}
              >
                <ImageCanvas image={thumb} label={label} className="photo-figure-canvas" />
                <span className="photo-figure-number" aria-hidden="true">
                  {index + 1}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </>
  );
}
