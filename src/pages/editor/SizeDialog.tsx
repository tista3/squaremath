// Grid size dialog: width/height (+ presets, square lock); confirms before cropping painted cells.
import { useState } from 'react';
import { ConfirmDialog, Modal } from '../../components/ui';
import { resizeDesign } from '../../core/design';
import { clampGridSize, GRID_SIZE_PRESETS } from '../../core/grid';
import { GRID_MAX, GRID_MIN, type Design } from '../../core/types';
import { t } from '../../i18n';
import { paintedCount } from './palette';

const PRESETS = GRID_SIZE_PRESETS;
const clampSize = clampGridSize;

interface Props {
  design: Design;
  onApply(next: Design): void;
  onClose(): void;
}

/** Mount only while open: the inputs start from the design's current size. */
export function SizeDialog({ design, onApply, onClose }: Props) {
  const [width, setWidth] = useState(String(design.width));
  const [height, setHeight] = useState(String(design.height));
  const [square, setSquare] = useState(design.width === design.height);
  const [crop, setCrop] = useState<{ next: Design; lost: number } | null>(null);

  const changeWidth = (v: string) => {
    setWidth(v);
    if (square) setHeight(v);
  };
  const changeHeight = (v: string) => {
    setHeight(v);
    if (square) setWidth(v);
  };
  const toggleSquare = () => {
    if (!square) setHeight(width);
    setSquare(!square);
  };

  const apply = () => {
    const w = clampSize(width, design.width);
    const h = clampSize(height, design.height);
    if (w === design.width && h === design.height) return onClose();
    const next = resizeDesign(design, w, h, 'center');
    const lost = paintedCount(design) - paintedCount(next);
    if (lost > 0) setCrop({ next, lost });
    else onApply(next);
  };

  const range = t('editor.sizeRange', { min: GRID_MIN, max: GRID_MAX });
  const footer = (
    <>
      <button type="button" className="btn" onClick={onClose}>{t('editor.cancel')}</button>
      <button type="button" className="btn primary" onClick={apply}>{t('editor.apply')}</button>
    </>
  );

  return (
    <>
      <Modal open={crop === null} title={t('editor.sizeTitle')} onClose={onClose} footer={footer}>
        <div className="stack ed-size">
          <div className="field-row">
            <SizeField label={t('editor.width')} hint={range} value={width} onChange={changeWidth} />
            <span className="ed-times" aria-hidden="true">×</span>
            <SizeField label={t('editor.height')} hint={range} value={height} onChange={changeHeight} />
          </div>
          <label className="row ed-check">
            <input type="checkbox" checked={square} onChange={toggleSquare} /> {t('editor.keepSquare')}
          </label>
          <div className="stack">
            <span className="muted">{t('editor.presets')}</span>
            <div className="toolbar">
              {PRESETS.map((n) => (
                <button key={n} type="button" className="btn" onClick={() => { setWidth(String(n)); setHeight(String(n)); setSquare(true); }}>
                  {n}×{n}
                </button>
              ))}
            </div>
          </div>
        </div>
      </Modal>
      <ConfirmDialog
        open={crop !== null}
        title={t('editor.cropTitle')}
        message={t('editor.cropMessage', { count: crop?.lost ?? 0 })}
        confirmLabel={t('editor.cropConfirm')}
        danger
        onConfirm={() => crop && onApply(crop.next)}
        onCancel={() => setCrop(null)}
      />
    </>
  );
}

function SizeField(p: { label: string; hint: string; value: string; onChange(v: string): void }) {
  return (
    <label className="field">
      <span>{p.label}</span>
      <input type="number" inputMode="numeric" min={GRID_MIN} max={GRID_MAX} value={p.value} onChange={(e) => p.onChange(e.target.value)} />
      <small className="muted">{p.hint}</small>
    </label>
  );
}
