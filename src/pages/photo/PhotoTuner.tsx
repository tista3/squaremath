// OWNER: photo-ui agent. Step 3: live preview + all conversion parameters, name and "Create design".
import { useId, useState, type FormEvent } from 'react';
import {
  COLOR_ALGORITHMS,
  CROP_MODES,
  PARAM_LIMITS,
  type CellSampling,
  type ColorAlgorithm,
  type Conversion,
  type ConvertParams,
  type CropMode,
} from '../../core/image/types';
import { GRID_MAX, GRID_MIN, NAME_MAX } from '../../core/types';
import { Icon } from '../../components/Icon';
import { IconButton } from '../../components/ui';
import { t } from '../../i18n';
import { Field, Segmented } from '../puzzle/Segmented';
import { ConversionCanvas } from './canvas';
import { clampParams, sameParams, signedPercent } from './helpers';
import type { PhotoSource, PresetView } from './prepare';
import { useLiveConversion } from './useLiveConversion';

const SAMPLINGS: CellSampling[] = ['dominant', 'average'];
const SMOOTHING_LEVELS = Array.from({ length: PARAM_LIMITS.smoothing.max - PARAM_LIMITS.smoothing.min + 1 }, (_, i) =>
  String(PARAM_LIMITS.smoothing.min + i),
);

export function PhotoTuner({
  source,
  view,
  name,
  onNameChange,
  onBack,
  onCreate,
}: {
  source: PhotoSource;
  view: PresetView;
  name: string;
  onNameChange: (name: string) => void;
  onBack: () => void;
  onCreate: (conversion: Conversion) => void;
}) {
  const { analysis } = source;
  const presetParams = view.preset.params;
  const [params, setParams] = useState<ConvertParams>(presetParams);
  const [gridLines, setGridLines] = useState(true);
  const live = useLiveConversion(analysis, params, { params: presetParams, conversion: view.conversion });
  const { conversion } = live;
  const ids = useId();
  const gridCount = analysis.grids.length;
  const set = <K extends keyof ConvertParams>(key: K, value: ConvertParams[K]) =>
    setParams((p) => clampParams({ ...p, [key]: value }, gridCount));

  // Grid mode copies a detected grid cell by cell: only colours, colour style and the background toggle apply.
  const isGrid = params.source === 'grid' && gridCount > 0;
  const grid = isGrid ? analysis.grids[params.gridIndex] : undefined;
  // In grid mode the core blanks the grid's most common edge colour, which exists for every grid.
  const hasBackground = isGrid || analysis.background !== null;
  const colours = conversion.palette.length - (conversion.backgroundRemoved ? 1 : 0);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const latest = live.latest();
    if (latest) onCreate(latest);
  };

  return (
    <div className="photo-tuner">
      <section className="panel photo-preview" aria-labelledby={`${ids}-preview`} aria-busy={live.pending}>
        <div className="photo-preview-head">
          <h2 id={`${ids}-preview`} tabIndex={-1} data-step-heading>
            {view.label}
          </h2>
          <span className="badge" title={t('photo.size')}>
            <Icon name="grid" size={16} />
            {conversion.width}×{conversion.height}
          </span>
          <span className="badge" title={t('photo.colourCount')}>
            <Icon name="palette" size={16} />
            {colours}
          </span>
          <span className="spacer" />
          <IconButton
            icon="grid"
            label={t('photo.gridLines')}
            aria-pressed={gridLines}
            className={gridLines ? 'active' : undefined}
            onClick={() => setGridLines((on) => !on)}
          />
        </div>
        <div className="photo-preview-frame">
          <ConversionCanvas conversion={conversion} gridLines={gridLines} label={t('photo.preview')} />
        </div>
        {live.failed && (
          <p className="error" role="alert">
            <Icon name="warning" size={18} />
            {t('photo.errorConvert')}
          </p>
        )}
        <PaletteList conversion={conversion} />
      </section>

      <div className="stack photo-controls">
        <section className="panel stack" aria-label={t('photo.tuneTitle')}>
          <div className="toolbar photo-tune-actions">
            <button type="button" className="btn" onClick={onBack}>
              <Icon name="back" />
              {t('photo.backToLayouts')}
            </button>
            <button
              type="button"
              className="btn"
              disabled={sameParams(params, presetParams)}
              title={t('photo.resetHint', { name: view.label })}
              onClick={() => setParams(presetParams)}
            >
              <Icon name="undo" />
              {t('photo.reset')}
            </button>
          </div>

          {isGrid ? (
            <>
              {gridCount > 1 && (
                <Field label={t('photo.gridPick')}>
                  <Segmented
                    label={t('photo.gridPick')}
                    value={String(params.gridIndex)}
                    options={analysis.grids.map((g, i) => {
                      const text = t('photo.gridItem', { n: i + 1, cols: g.cols, rows: g.rows });
                      return { value: String(i), label: String(i + 1), title: text, ariaLabel: text };
                    })}
                    onChange={(v) => set('gridIndex', Number(v))}
                  />
                </Field>
              )}
              <div className="field photo-fixed-size">
                <span className="label">{t('photo.size')}</span>
                <span className="photo-fixed-size-value">
                  <Icon name="grid" size={20} />
                  {t('photo.gridSizeValue', { cols: grid?.cols ?? conversion.width, rows: grid?.rows ?? conversion.height })}
                </span>
              </div>
            </>
          ) : (
            <RangeField
              label={t('photo.gridWidth')}
              value={params.width}
              min={GRID_MIN}
              max={GRID_MAX}
              output={t('photo.gridWidthValue', { width: params.width, size: `${conversion.width}×${conversion.height}` })}
              onChange={(v) => set('width', v)}
            />
          )}
          <RangeField
            label={t('photo.colours')}
            value={params.colors}
            min={PARAM_LIMITS.colors.min}
            max={PARAM_LIMITS.colors.max}
            onChange={(v) => set('colors', v)}
          />
          <Field label={t('photo.algorithm')}>
            <Segmented<ColorAlgorithm>
              label={t('photo.algorithm')}
              value={params.algorithm}
              options={COLOR_ALGORITHMS.map((a) => ({ value: a, label: t(`photo.algo_${a}`), title: t(`photo.algoHint_${a}`) }))}
              onChange={(v) => set('algorithm', v)}
            />
            <p className="muted photo-hint">{t(`photo.algoHint_${params.algorithm}`)}</p>
          </Field>
          {!isGrid && (
            <>
              <Field label={t('photo.sampling')}>
                <Segmented<CellSampling>
                  label={t('photo.sampling')}
                  value={params.sampling}
                  options={SAMPLINGS.map((s) => ({ value: s, label: t(`photo.sampling_${s}`), title: t(`photo.samplingHint_${s}`) }))}
                  onChange={(v) => set('sampling', v)}
                />
              </Field>
              <Field label={t('photo.crop')}>
                <Segmented<CropMode>
                  label={t('photo.crop')}
                  value={params.crop}
                  options={CROP_MODES.map((c) => ({ value: c, label: t(`photo.crop_${c}`), title: t(`photo.cropHint_${c}`) }))}
                  onChange={(v) => set('crop', v)}
                />
              </Field>
            </>
          )}

          <div className="stack photo-background">
            <label className="photo-toggle">
              <input
                type="checkbox"
                checked={hasBackground && params.removeBackground}
                disabled={!hasBackground}
                onChange={(e) => set('removeBackground', e.target.checked)}
              />
              <span>{t('photo.removeBackground')}</span>
              {!isGrid && analysis.background && (
                <span className="photo-swatch" style={{ background: analysis.background }} title={analysis.background} aria-hidden="true" />
              )}
            </label>
            <p className="muted photo-hint">
              {isGrid ? t('photo.gridBackgroundHint') : hasBackground ? t('photo.removeBackgroundHint') : t('photo.noBackground')}
            </p>
            {!isGrid && (
              <RangeField
                label={t('photo.tolerance')}
                value={params.backgroundTolerance}
                min={PARAM_LIMITS.backgroundTolerance.min}
                max={PARAM_LIMITS.backgroundTolerance.max}
                disabled={!hasBackground || !params.removeBackground}
                hint={t('photo.toleranceHint')}
                onChange={(v) => set('backgroundTolerance', v)}
              />
            )}
          </div>

          {!isGrid && (
            <>
              <Field label={t('photo.smoothing')}>
                <Segmented
                  label={t('photo.smoothing')}
                  value={String(params.smoothing)}
                  options={SMOOTHING_LEVELS.map((s) => ({ value: s, label: s === '0' ? t('photo.smoothingOff') : s }))}
                  onChange={(v) => set('smoothing', Number(v))}
                />
                <p className="muted photo-hint">{t('photo.smoothingHint')}</p>
              </Field>
              <RangeField
                label={t('photo.saturation')}
                value={params.saturation}
                min={PARAM_LIMITS.saturation.min}
                max={PARAM_LIMITS.saturation.max}
                output={signedPercent(params.saturation)}
                onChange={(v) => set('saturation', v)}
              />
              <RangeField
                label={t('photo.contrast')}
                value={params.contrast}
                min={PARAM_LIMITS.contrast.min}
                max={PARAM_LIMITS.contrast.max}
                output={signedPercent(params.contrast)}
                onChange={(v) => set('contrast', v)}
              />
            </>
          )}
        </section>

        <section className="panel photo-palette-narrow">
          <PaletteList conversion={conversion} />
        </section>

        <form className="panel stack photo-create" onSubmit={submit}>
          <div className="field">
            <label htmlFor={`${ids}-name`}>{t('photo.name')}</label>
            <input
              id={`${ids}-name`}
              type="text"
              value={name}
              maxLength={NAME_MAX}
              placeholder={t('photo.defaultName')}
              onChange={(e) => onNameChange(e.target.value)}
            />
          </div>
          <button type="submit" className="btn primary big photo-create-button" disabled={live.failed}>
            <Icon name="check" />
            {t('photo.create')}
          </button>
          <p className="muted photo-hint">{t('photo.createHint')}</p>
        </form>
      </div>
    </div>
  );
}

function PaletteList({ conversion }: { conversion: Conversion }) {
  return (
    <ul className="photo-palette" role="list" aria-label={t('photo.palette')}>
      {conversion.palette.map((c, i) => (
        <li key={`${c.hex}-${i}`} className="photo-palette-item">
          <span className="photo-swatch" style={{ background: c.hex }} aria-hidden="true" />
          <span>{c.name}</span>
          {conversion.backgroundRemoved && i === 0 && <span className="muted">({t('photo.paletteBackground')})</span>}
        </li>
      ))}
    </ul>
  );
}

function RangeField({
  label,
  value,
  min,
  max,
  step = 1,
  output,
  hint,
  disabled,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  output?: string;
  hint?: string;
  disabled?: boolean;
  onChange: (value: number) => void;
}) {
  const id = useId();
  const shown = output ?? String(value);
  return (
    <div className={`field photo-range${disabled ? ' disabled' : ''}`}>
      <div className="photo-range-head">
        <label htmlFor={id}>{label}</label>
        <output htmlFor={id}>{shown}</output>
      </div>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        aria-valuetext={shown}
        aria-describedby={hint ? `${id}-hint` : undefined}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      {hint && (
        <p id={`${id}-hint`} className="muted photo-hint">
          {hint}
        </p>
      )}
    </div>
  );
}
