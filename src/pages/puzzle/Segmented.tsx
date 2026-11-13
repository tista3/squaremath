import type { ReactNode } from 'react';

export interface SegOption<T extends string> {
  value: T;
  label: ReactNode;
  title?: string;
  /** Accessible name when the label is a symbol or glyph. */
  ariaLabel?: string;
}

/** Segmented control (global .seg contract): one pressed button among several. */
export function Segmented<T extends string>(props: {
  label: string;
  value: T;
  options: SegOption<T>[];
  onChange: (value: T) => void;
  className?: string;
}) {
  const { label, value, options, onChange, className } = props;
  return (
    <div className={`seg${className ? ` ${className}` : ''}`} role="group" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          className={`btn${o.value === value ? ' active' : ''}`}
          aria-pressed={o.value === value}
          title={o.title}
          aria-label={o.ariaLabel}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Labelled form field (global .field contract). */
export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="field">
      <span className="label">{label}</span>
      {children}
    </div>
  );
}
