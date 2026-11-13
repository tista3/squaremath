// Palette: pick a colour, rename it (names go on the B/W legend), recolour, add, delete, set background.
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Icon } from '../../components/Icon';
import { ConfirmDialog, InlineEdit } from '../../components/ui';
import { nearestColorName, normalizeHex, textColorFor } from '../../core/colors';
import { addPaletteColor, removePaletteColor, usedColorIds } from '../../core/design';
import { maxColorsFor } from '../../core/puzzle';
import { MAX_PALETTE, NAME_MAX, type Design, type PaletteColor } from '../../core/types';
import { t } from '../../i18n';
import { routes } from '../../routes';
import { snapshotOf, type Snapshot } from './history';
import { countCells, duplicateNames, nextFreshColor, recolor, uniqueName } from './palette';

interface Props {
  design: Design;
  basePath: string;
  selectedId: string;
  onSelect(colorId: string): void;
  commit(next: Snapshot): void;
}

export function PalettePanel({ design, basePath, selectedId, onSelect, commit }: Props) {
  const counts = countCells(design.cells);
  const selected = design.palette.find((c) => c.id === selectedId) ?? design.palette[0];

  const updateColor = (id: string, update: (c: PaletteColor) => PaletteColor) =>
    commit({ ...snapshotOf(design), palette: design.palette.map((c) => (c.id === id ? update(c) : c)) });

  const addColor = (hex: string, name: string) => {
    const next = addPaletteColor(design, hex, name);
    const added = next.palette.find((c) => !design.palette.some((old) => old.id === c.id));
    commit(next);
    if (added) onSelect(added.id);
  };

  return (
    <section className="panel ed-palette" aria-labelledby="ed-palette-title">
      <h2 id="ed-palette-title" className="ed-panel-title">
        <Icon name="palette" /> {t('editor.palette')}
      </h2>
      <div className="ed-swatches" role="group" aria-labelledby="ed-palette-title">
        {design.palette.map((c) => (
          <SwatchButton
            key={c.id}
            color={c}
            count={counts.get(c.id) ?? 0}
            selected={c.id === selected.id}
            isBackground={c.id === design.backgroundId}
            onSelect={() => onSelect(c.id)}
          />
        ))}
      </div>
      <SelectedColor
        key={selected.id}
        color={selected}
        count={counts.get(selected.id) ?? 0}
        design={design}
        onUpdate={(update) => updateColor(selected.id, update)}
        onSetBackground={() => commit({ ...snapshotOf(design), backgroundId: selected.id })}
        onDelete={() => commit(removePaletteColor(design, selected.id))}
      />
      <AddColor palette={design.palette} onAdd={addColor} />
      <p className="muted ed-hint">
        <Icon name="info" size={16} /> {t('editor.paletteHint')}
      </p>
      <PaletteWarnings design={design} basePath={basePath} />
    </section>
  );
}

function SwatchButton(p: { color: PaletteColor; count: number; selected: boolean; isBackground: boolean; onSelect(): void }) {
  const label = t('editor.selectColor', { name: p.color.name, count: p.count });
  return (
    <button type="button" className="ed-swatch-btn" aria-pressed={p.selected} aria-label={label} title={label} onClick={p.onSelect}>
      <span className={p.selected ? 'swatch selected ed-swatch' : 'swatch ed-swatch'} style={{ background: p.color.hex, color: textColorFor(p.color.hex) }}>
        {p.isBackground ? <Icon name="star" size={16} title={t('editor.backgroundMark')} /> : p.count > 0 && <span className="ed-count">{p.count}</span>}
      </span>
      <span className="ed-swatch-name">{p.color.name}</span>
    </button>
  );
}

function SelectedColor(p: {
  color: PaletteColor;
  count: number;
  design: Design;
  onUpdate(update: (c: PaletteColor) => PaletteColor): void;
  onSetBackground(): void;
  onDelete(): void;
}) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const isBackground = p.color.id === p.design.backgroundId;
  const background = p.design.palette.find((c) => c.id === p.design.backgroundId);

  const rename = (value: string) => {
    const name = value.trim().slice(0, NAME_MAX);
    if (name) p.onUpdate((c) => ({ ...c, name }));
  };
  const changeHex = (value: string) => {
    const hex = normalizeHex(value);
    if (hex && hex !== p.color.hex) p.onUpdate((c) => recolor(c, hex, nearestColorName));
  };
  const remove = () => (p.count > 0 ? setConfirmDelete(true) : p.onDelete());

  return (
    <div className="ed-selected">
      <ColorInput key={p.color.hex} value={p.color.hex} label={t('editor.changeColor')} onCommit={changeHex} />
      <InlineEdit className="ed-color-name" value={p.color.name} maxLength={NAME_MAX} ariaLabel={t('editor.colorName')} onCommit={rename} />
      <button
        type="button"
        className={isBackground ? 'btn icon active' : 'btn icon'}
        aria-label={isBackground ? t('editor.isBackground') : t('editor.setBackground')}
        title={isBackground ? t('editor.isBackground') : t('editor.setBackground')}
        aria-pressed={isBackground}
        disabled={isBackground}
        onClick={p.onSetBackground}
      >
        <Icon name="star" />
      </button>
      <button
        type="button"
        className="btn icon danger"
        aria-label={isBackground ? t('editor.cannotDeleteBackground') : t('editor.deleteColor')}
        title={isBackground ? t('editor.cannotDeleteBackground') : t('editor.deleteColor')}
        disabled={isBackground}
        onClick={remove}
      >
        <Icon name="trash" />
      </button>
      <ConfirmDialog
        open={confirmDelete}
        title={t('editor.deleteTitle', { name: p.color.name })}
        message={t('editor.deleteMessage', { count: p.count, background: background?.name ?? '' })}
        confirmLabel={t('editor.deleteConfirm')}
        danger
        onConfirm={() => {
          setConfirmDelete(false);
          p.onDelete();
        }}
        onCancel={() => setConfirmDelete(false)}
      />
    </div>
  );
}

/** Colour input that commits once when the picker is closed (native "change"), not on every drag step. */
function ColorInput(p: { value: string; label: string; onCommit(hex: string): void }) {
  const [value, setValue] = useState(p.value);
  const ref = useRef<HTMLInputElement>(null);
  const { onCommit } = p;
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const commit = () => onCommit(el.value);
    el.addEventListener('change', commit);
    return () => el.removeEventListener('change', commit);
  }, [onCommit]);
  return (
    <input
      ref={ref}
      type="color"
      className="ed-color-input"
      value={value}
      aria-label={p.label}
      title={p.label}
      onChange={(e) => setValue(e.target.value)}
    />
  );
}

/** New-colour picker. It always offers a colour that is not in the palette yet, and moves on to the next
 * fresh preset after each add, so repeated taps never create duplicate entries or duplicate names. */
function AddColor({ palette, onAdd }: { palette: PaletteColor[]; onAdd(hex: string, name: string): void }) {
  const [hex, setHex] = useState(() => nextFreshColor(palette));
  if (palette.length >= MAX_PALETTE) return <p className="muted">{t('editor.paletteFull', { max: MAX_PALETTE })}</p>;
  const norm = normalizeHex(hex) ?? hex;
  const existing = palette.find((c) => c.hex.toLowerCase() === norm);
  const name = uniqueName(nearestColorName(norm), palette);
  const add = () => {
    onAdd(norm, name);
    setHex(nextFreshColor([...palette, { id: '', name, hex: norm }], norm));
  };
  return (
    <div className="ed-add">
      <input
        type="color"
        className="ed-color-input"
        value={hex}
        aria-label={t('editor.newColor')}
        title={t('editor.newColor')}
        onChange={(e) => setHex(e.target.value)}
      />
      <span className="ed-add-name muted">
        {existing ? t('editor.colorExists', { name: existing.name }) : t('editor.suggestedName', { name })}
      </span>
      <button type="button" className="btn" disabled={existing !== undefined} onClick={add}>
        <Icon name="plus" /> {t('editor.addColor')}
      </button>
    </div>
  );
}

function PaletteWarnings({ design, basePath }: { design: Design; basePath: string }) {
  const duplicates = duplicateNames(design.palette);
  const used = usedColorIds(design).length;
  const max = maxColorsFor(design.puzzle);
  return (
    <>
      {duplicates.length > 0 && (
        <p className="warning" role="status">
          <Icon name="warning" /> {t('editor.warnDuplicate', { names: duplicates.join('", "') })}
        </p>
      )}
      {used > max && (
        <p className="warning" role="status">
          <Icon name="warning" /> {t('editor.warnTooMany', { used, max })}{' '}
          <Link to={routes.sub(basePath, 'puzzle')}>{t('editor.warnTooManyLink')}</Link>
        </p>
      )}
    </>
  );
}
