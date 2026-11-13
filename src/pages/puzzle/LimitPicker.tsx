import { useId, useState, type KeyboardEvent } from 'react';
import { Icon } from '../../components/Icon';
import { t } from '../../i18n';
import { clampLimit, type Limits } from './settings';
import { Field } from './Segmented';

/** Number limit chooser: preset buttons plus a "custom" button revealing a clamped number input. */
export function LimitPicker(props: {
  label: string;
  value: number;
  presets: readonly number[];
  limits: Limits;
  onChange: (value: number) => void;
}) {
  const { label, value, presets, limits, onChange } = props;
  const inputId = useId();
  const [custom, setCustom] = useState(!presets.includes(value));
  const [draft, setDraft] = useState(String(value));
  const [shownValue, setShownValue] = useState(value);
  if (value !== shownValue) {
    // Value changed elsewhere (quick fix, other tab): resync the draft.
    setShownValue(value);
    setDraft(String(value));
    if (!presets.includes(value)) setCustom(true);
  }

  const commit = () => {
    // An empty or garbled field keeps the current value (Number('') would be 0, i.e. the minimum).
    if (draft.trim() === '' || !Number.isFinite(Number(draft))) {
      setDraft(String(value));
      return;
    }
    const next = clampLimit(Number(draft), limits, value);
    setDraft(String(next));
    if (next !== value) onChange(next);
  };
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') commit();
    if (e.key === 'Escape') setDraft(String(value));
  };
  const pickPreset = (preset: number) => {
    setCustom(false);
    onChange(preset);
  };

  return (
    <Field label={label}>
      <div className="seg puzzle-limits" role="group" aria-label={label}>
        {presets.map((p) => {
          const active = !custom && p === value;
          return (
            <button key={p} type="button" className={`btn${active ? ' active' : ''}`} aria-pressed={active} onClick={() => pickPreset(p)}>
              {p}
            </button>
          );
        })}
        <button
          type="button"
          className={`btn${custom ? ' active' : ''}`}
          aria-pressed={custom}
          aria-label={t('puzzle.customTitle')}
          title={t('puzzle.customTitle')}
          onClick={() => setCustom(true)}
        >
          <Icon name="pencil" size={20} />
          <span aria-hidden="true">…</span>
        </button>
      </div>
      {custom && (
        <div className="row puzzle-custom">
          <input
            id={inputId}
            type="number"
            inputMode="numeric"
            min={limits.min}
            max={limits.max}
            value={draft}
            aria-label={t('puzzle.customValue', { min: limits.min, max: limits.max })}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={onKeyDown}
          />
          <label htmlFor={inputId} className="muted">
            {limits.min}–{limits.max}
          </label>
        </div>
      )}
    </Field>
  );
}
