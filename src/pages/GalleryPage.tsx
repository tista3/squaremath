// OWNER: shell agent. Home: my designs + templates; create, duplicate, rename, delete, share, import/export.
import { useId, useMemo, useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { buildShareUrl, encodeDesign } from '../core/codec';
import { usedColorIds } from '../core/design';
import { isNewerLibraryFile, parseLibraryFile } from '../core/fileio';
import { clampGridSize, GRID_SIZE_PRESETS } from '../core/grid';
import { TEMPLATES } from '../core/samples';
import { GRID_MAX, GRID_MIN, NAME_MAX, type Design } from '../core/types';
import { safeFileName } from '../export';
import { t } from '../i18n';
import { Icon } from '../components/Icon';
import { downloadDesignsJson, downloadLibrary, findCopyOf, importSummary, MAX_IMPORT_BYTES } from '../components/library';
import { ConfirmDialog, DesignPicture, IconButton, InlineEdit, Modal, OpsBadge, ShareDialog, useToast } from '../components/ui';
import { routes, type DesignSubPage } from '../routes';
import { useDesignStore } from '../state/store';
import './GalleryPage.css';

export default function GalleryPage() {
  const store = useDesignStore();
  const [creating, setCreating] = useState(false);
  const navigate = useNavigate();

  const create = (opts: { name: string; width: number; height: number }) => {
    const design = store.create(opts);
    setCreating(false);
    navigate(routes.design(design.id, 'edit'));
  };

  return (
    <div className="page gallery">
      <header className="page-header">
        <h1>{t('gallery.title')}</h1>
        <div className="toolbar">
          <button type="button" className="btn primary big" onClick={() => setCreating(true)}>
            <Icon name="plus" />
            {t('gallery.newDesign')}
          </button>
          <LibraryTransfer />
        </div>
      </header>

      <section className="stack" aria-labelledby="gallery-mine">
        <h2 id="gallery-mine">{t('gallery.myDesigns')}</h2>
        {store.designs.length > 0 ? (
          <div className="grid-cards">
            {store.designs.map((d) => (
              <DesignCard key={d.id} design={d} />
            ))}
          </div>
        ) : (
          <EmptyState />
        )}
      </section>

      <section className="stack" aria-labelledby="gallery-templates">
        <h2 id="gallery-templates">{t('gallery.templates')}</h2>
        <p className="muted">{t('gallery.templatesHint')}</p>
        <div className="grid-cards">
          {TEMPLATES.map((tpl) => (
            <TemplateCard key={tpl.id} template={tpl} />
          ))}
        </div>
      </section>

      <Modal open={creating} title={t('gallery.newDesign')} onClose={() => setCreating(false)} footer={<NewDesignFooter />}>
        <NewDesignForm onCreate={create} />
      </Modal>
    </div>
  );
}

// ---- Library import / export ----

function LibraryTransfer() {
  const store = useDesignStore();
  const toast = useToast();
  const fileInput = useRef<HTMLInputElement>(null);

  const importFile = async (file: File) => {
    if (file.size > MAX_IMPORT_BYTES) {
      toast(t('gallery.importTooLarge'), 'error');
      return;
    }
    let parsed: ReturnType<typeof parseLibraryFile> = null;
    let text = '';
    try {
      text = await file.text();
      parsed = parseLibraryFile(text);
    } catch {
      parsed = null;
    }
    if (!parsed || parsed.designs.length === 0) {
      toast(t(isNewerLibraryFile(text) ? 'gallery.importNewer' : 'gallery.importInvalid'), 'error');
      return;
    }
    const { added, updated, skipped } = store.importDesigns(parsed.designs);
    toast(importSummary({ added, updated, skipped, invalid: parsed.invalid }), added + updated > 0 ? 'success' : 'info');
  };

  const onFileChosen = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // allow choosing the same file again
    if (file) void importFile(file);
  };

  return (
    <>
      <button type="button" className="btn big" onClick={() => fileInput.current?.click()} title={t('gallery.importHint')}>
        <Icon name="upload" />
        {t('gallery.import')}
      </button>
      <button
        type="button"
        className="btn big"
        disabled={store.designs.length === 0}
        onClick={() => downloadLibrary(store.designs)}
        title={t('gallery.exportHint')}
      >
        <Icon name="download" />
        {t('gallery.export')}
      </button>
      <input
        ref={fileInput}
        type="file"
        accept=".json,application/json"
        hidden
        aria-label={t('gallery.import')}
        onChange={onFileChosen}
      />
    </>
  );
}

// ---- Cards ----
// Both card types share one layout: picture, name, facts, [primary | Solve] buttons; own designs add icon actions.

function CardMeta({ design }: { design: Design }) {
  const colours = useMemo(() => usedColorIds(design).length, [design]);
  return (
    <p className="card-meta muted">
      <span title={t('gallery.size')}>
        <Icon name="grid" size={18} />
        {design.width}×{design.height}
      </span>
      <span title={t('gallery.colours')}>
        <Icon name="palette" size={18} />
        {colours}
      </span>
      <OpsBadge ops={design.puzzle.ops} />
    </p>
  );
}

/** Accessible name of a card action that names the design, so the same button on many cards can be told apart. */
function actionOn(actionKey: string, name: string): string {
  return t('gallery.actionOn', { action: t(actionKey), name });
}

function DesignCard({ design }: { design: Design }) {
  const store = useDesignStore();
  const toast = useToast();
  const [dialog, setDialog] = useState<'share' | 'delete' | null>(null);
  const nameId = useId();
  const page = (p: DesignSubPage) => routes.design(design.id, p);
  const closeDialog = () => setDialog(null);
  const label = (key: string) => actionOn(key, design.name);

  const duplicate = () => {
    const copy = store.duplicate(design.id);
    if (copy) toast(t('gallery.duplicated', { name: copy.name }), 'success');
  };
  const remove = () => {
    closeDialog();
    store.remove(design.id);
    // Re-importing the removed object restores it unchanged (same id, so its solve progress still applies).
    toast(t('gallery.deleted', { name: design.name }), 'info', {
      label: t('gallery.undo'),
      icon: 'undo',
      onClick: () => store.importDesigns([design]),
    });
  };

  return (
    <article className="card design-card">
      <Link to={page('edit')} className="card-thumb" aria-label={label('gallery.colourIt')} title={t('gallery.colourIt')}>
        <DesignPicture design={design} />
      </Link>
      <label className="card-name-row" title={t('gallery.rename')}>
        <InlineEdit
          id={nameId}
          value={design.name}
          maxLength={NAME_MAX}
          ariaLabel={t('gallery.rename')}
          className="card-name"
          onCommit={(name) => store.rename(design.id, name)}
        />
        <Icon name="rename" size={20} className="card-name-icon" />
      </label>
      <CardMeta design={design} />
      <div className="card-buttons">
        <Link to={page('edit')} className="btn primary" aria-describedby={nameId}>
          <Icon name="pencil" />
          {t('gallery.colourIt')}
        </Link>
        <Link to={page('solve')} className="btn" aria-describedby={nameId} title={t('gallery.solveHint')}>
          <Icon name="play" />
          {t('gallery.solve')}
        </Link>
      </div>
      <div className="card-actions">
        <Link to={page('puzzle')} className="btn icon" aria-label={label('gallery.puzzle')} title={t('gallery.puzzle')}>
          <Icon name="print" />
        </Link>
        <IconButton icon="copy" label={label('gallery.duplicate')} onClick={duplicate} />
        <IconButton icon="share" label={label('gallery.share')} onClick={() => setDialog('share')} />
        <IconButton
          icon="download"
          label={label('gallery.downloadJson')}
          onClick={() => downloadDesignsJson([design], `${safeFileName(design.name)}.json`)}
        />
        <IconButton icon="trash" label={label('gallery.delete')} className="card-delete" onClick={() => setDialog('delete')} />
      </div>
      <ShareDialog open={dialog === 'share'} url={dialog === 'share' ? buildShareUrl(design) : ''} title={design.name} onClose={closeDialog} />
      <ConfirmDialog
        open={dialog === 'delete'}
        title={t('gallery.deleteTitle')}
        preview={<DesignPicture design={design} maxPx={160} />}
        message={t('gallery.deleteMessage', { name: design.name })}
        confirmLabel={t('gallery.delete')}
        danger
        onConfirm={remove}
        onCancel={closeDialog}
      />
    </article>
  );
}

function TemplateCard({ template }: { template: Design }) {
  const store = useDesignStore();
  const toast = useToast();
  const navigate = useNavigate();
  const titleId = useId();
  // Solving needs no library copy: the template opens like a shared link, whose progress is kept per picture.
  const solvePath = useMemo(() => routes.sub(routes.shared(encodeDesign(template)), 'solve'), [template]);

  /** Opens the user's unchanged copy of this template when there is one, otherwise saves a new copy. */
  const use = () => {
    const existing = findCopyOf(store.designs, template);
    const copy = existing ?? store.saveCopy(template);
    if (existing) toast(t('gallery.templateOpened', { name: copy.name }));
    else toast(t('gallery.templateSaved', { name: copy.name }), 'success');
    navigate(routes.design(copy.id, 'edit'));
  };

  return (
    <article className="card template-card">
      <button
        type="button"
        className="card-thumb"
        onClick={use}
        aria-label={actionOn('gallery.use', template.name)}
        title={t('gallery.useHint')}
      >
        <DesignPicture design={template} />
      </button>
      <h3 id={titleId} className="card-title">
        {template.name}
      </h3>
      <CardMeta design={template} />
      <div className="card-buttons">
        <button type="button" className="btn primary" onClick={use} aria-describedby={titleId} title={t('gallery.useHint')}>
          <Icon name="pencil" />
          {t('gallery.use')}
        </button>
        <Link to={solvePath} className="btn" aria-describedby={titleId} title={t('gallery.solveHint')}>
          <Icon name="play" />
          {t('gallery.solve')}
        </Link>
      </div>
    </article>
  );
}

// ---- Empty state ----

// A tiny pixel heart: 'x' = filled cell.
const HEART = ['.xx.xx.', 'xxxxxxx', 'xxxxxxx', '.xxxxx.', '..xxx..', '...x...'];

/** Compact on purpose (the "New design" button is right above), so the templates stay in view on phones. */
function EmptyState() {
  return (
    <div className="panel empty-state">
      <svg className="empty-art" viewBox="0 0 70 60" aria-hidden="true" focusable="false">
        {HEART.flatMap((row, y) =>
          [...row].map((c, x) => (
            <rect key={`${x}-${y}`} x={x * 10} y={y * 10} width="10" height="10" className={c === 'x' ? 'on' : 'off'} />
          )),
        )}
      </svg>
      <div className="stack empty-text">
        <h3>{t('gallery.emptyTitle')}</h3>
        <p className="muted">{t('gallery.emptyText')}</p>
      </div>
    </div>
  );
}

// ---- New design ----

const SIZE_PRESETS = GRID_SIZE_PRESETS;
const DEFAULT_SIZE = 16;
const NEW_DESIGN_FORM_ID = 'new-design-form';

function clampSize(raw: string): number {
  return clampGridSize(raw, DEFAULT_SIZE);
}

function NewDesignFooter() {
  return (
    <button type="submit" form={NEW_DESIGN_FORM_ID} className="btn primary big">
      <Icon name="check" />
      {t('gallery.create')}
    </button>
  );
}

function NewDesignForm({ onCreate }: { onCreate: (opts: { name: string; width: number; height: number }) => void }) {
  const [name, setName] = useState('');
  const [preset, setPreset] = useState<number | 'custom'>(DEFAULT_SIZE);
  const [custom, setCustom] = useState({ width: String(DEFAULT_SIZE), height: String(DEFAULT_SIZE) });
  const ids = useId();

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const size =
      preset === 'custom' ? { width: clampSize(custom.width), height: clampSize(custom.height) } : { width: preset, height: preset };
    onCreate({ name: name.trim() || t('gallery.defaultName'), ...size });
  };

  return (
    <form id={NEW_DESIGN_FORM_ID} className="stack new-design" onSubmit={submit}>
      <div className="field">
        <label htmlFor={`${ids}-name`}>{t('gallery.name')}</label>
        <input
          id={`${ids}-name`}
          type="text"
          value={name}
          maxLength={NAME_MAX}
          placeholder={t('gallery.defaultName')}
          data-autofocus
          onChange={(e) => setName(e.target.value)}
        />
      </div>
      <div className="field" role="group" aria-labelledby={`${ids}-size`}>
        <span id={`${ids}-size`} className="label">
          {t('gallery.size')}
        </span>
        <div className="seg">
          {SIZE_PRESETS.map((n) => (
            <button key={n} type="button" className="btn" aria-pressed={preset === n} onClick={() => setPreset(n)}>
              {n}×{n}
            </button>
          ))}
          <button type="button" className="btn" aria-pressed={preset === 'custom'} onClick={() => setPreset('custom')}>
            <Icon name="resize" size={20} />
            {t('gallery.custom')}
          </button>
        </div>
      </div>
      {preset === 'custom' && (
        <div className="field-row">
          {(['width', 'height'] as const).map((dim) => (
            <div className="field" key={dim}>
              <label htmlFor={`${ids}-${dim}`}>{t(`gallery.${dim}`)}</label>
              <input
                id={`${ids}-${dim}`}
                type="number"
                inputMode="numeric"
                min={GRID_MIN}
                max={GRID_MAX}
                value={custom[dim]}
                onChange={(e) => setCustom((c) => ({ ...c, [dim]: e.target.value }))}
                onBlur={(e) => setCustom((c) => ({ ...c, [dim]: String(clampSize(e.target.value)) }))}
              />
            </div>
          ))}
          <p className="muted size-range">{t('gallery.sizeRange', { min: GRID_MIN, max: GRID_MAX })}</p>
        </div>
      )}
    </form>
  );
}
