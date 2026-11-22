// OWNER: shell agent. Shared UI primitives + global CSS class contract.
//
// Global CSS classes (defined in src/styles/global.css by the shell agent; use them in all pages):
//   Layout:   .page (max-width container with padding), .page-header (title row + actions), .toolbar
//             (horizontal wrap row of controls), .panel (bordered card section), .grid-cards (responsive grid
//             of .card), .row (flex row, gap), .stack (flex column, gap), .spacer (flex:1), .muted, .hidden-print
//   Buttons:  .btn (default), .btn.primary, .btn.danger, .btn.ghost, .btn.icon (square icon-only button,
//             must have aria-label+title), .btn.active (pressed tool), .btn.big (large kid-friendly)
//   Forms:    .field (label + control column), .field-row, input/select/textarea styled globally,
//             .seg (segmented control container; children .btn)
//   Misc:     .swatch (colour square; set background inline), .swatch.selected, .badge, .warning (inline
//             warning box), .error
// Design tokens (CSS custom properties on :root): --bg, --surface, --text, --muted, --border, --accent,
//   --accent-text, --danger, --danger-text (text on a --danger background), --radius, --gap, --shadow. Kid-friendly, rounded, high-contrast, works on touch.
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import type { SymbolSet } from '../core/symbols';
import type { Design, Op, PrintSettings, PuzzleSettings } from '../core/types';
import { renderDesignSVG } from '../render/sheet';
import { t } from '../i18n';
import { Icon, type IconName } from './Icon';

/**
 * Accessible modal dialog (Esc / backdrop closes). Mark the control that should take focus on open with
 * `data-autofocus` (React's autoFocus fires before the dialog is shown, and showModal() then moves focus).
 */
export function Modal({
  open,
  title,
  onClose,
  children,
  footer,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  // Backdrop close only when the press both started and ended on the backdrop (not a text-selection drag).
  const pressedBackdrop = useRef(false);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      if (typeof dialog.showModal === 'function') dialog.showModal();
      else dialog.setAttribute('open', '');
      dialog.querySelector<HTMLElement>('[data-autofocus]')?.focus();
    } else if (!open && dialog.open) {
      closeDialog(dialog);
    }
  }, [open]);
  // No close-on-unmount cleanup: removing an open <dialog> takes it out of the top layer anyway, and under
  // StrictMode the cleanup's close() would queue a 'close' event that arrives after the dialog reopened.

  return (
    <dialog
      ref={ref}
      className="modal"
      aria-labelledby={titleId}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      // The browser may still force-close (repeated Esc); keep the parent's `open` state in sync. A stale
      // event from an earlier close() (the dialog has since been reopened) is ignored.
      onClose={() => {
        if (open && !ref.current?.open) onClose();
      }}
      onPointerDown={(e) => {
        pressedBackdrop.current = e.target === e.currentTarget;
      }}
      onClick={(e) => {
        if (pressedBackdrop.current && e.target === e.currentTarget) onClose();
        pressedBackdrop.current = false;
      }}
    >
      {open && (
        <div className="modal-content">
          <header className="modal-header">
            <h2 id={titleId}>{title}</h2>
            <IconButton icon="close" label={t('common.close')} className="ghost" onClick={onClose} />
          </header>
          <div className="modal-body">{children}</div>
          {footer && <footer className="modal-footer">{footer}</footer>}
        </div>
      )}
    </dialog>
  );
}

function closeDialog(dialog: HTMLDialogElement): void {
  if (typeof dialog.close === 'function') dialog.close();
  else dialog.removeAttribute('open');
}

/** Confirmation modal; resolves via callbacks. `preview` (e.g. a picture) is shown above the message. */
export function ConfirmDialog({
  open,
  title,
  message,
  preview,
  confirmLabel,
  danger,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  message?: ReactNode;
  preview?: ReactNode;
  confirmLabel?: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <Modal
      open={open}
      title={title}
      onClose={onCancel}
      footer={
        <>
          <button type="button" className="btn" onClick={onCancel}>
            {t('common.cancel')}
          </button>
          <button type="button" className={danger ? 'btn danger' : 'btn primary'} onClick={onConfirm}>
            <Icon name={danger ? 'trash' : 'check'} />
            {confirmLabel ?? t('common.ok')}
          </button>
        </>
      }
    >
      {preview && <div className="confirm-preview">{preview}</div>}
      {message && <div className="confirm-message">{message}</div>}
    </Modal>
  );
}

export type ToastKind = 'info' | 'success' | 'error';
/** Optional button on a toast (e.g. Undo); clicking it runs `onClick` and dismisses the toast. */
export interface ToastAction {
  label: string;
  icon?: IconName;
  onClick: () => void;
}
export type ShowToast = (message: string, kind?: ToastKind, action?: ToastAction) => void;
interface ToastItem {
  id: number;
  message: string;
  kind: ToastKind;
  action?: ToastAction;
}

const MAX_TOASTS = 4;
const TOAST_ICON: Record<ToastKind, IconName> = { info: 'info', success: 'check', error: 'warning' };
/** How long a toast stays (ms): short for good news, longer for errors and toasts the user can act on. */
const TOAST_MS: Record<ToastKind, number> = { success: 2500, info: 3500, error: 7000 };
const ACTION_TOAST_MS = 7000;
const ToastContext = createContext<ShowToast>(() => {});

/** Toast notifications. Wrap the app in <ToastProvider>; call useToast()(message, 'error', action?). */
export function ToastProvider({ children }: { children: ReactNode }): ReactNode {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const nextId = useRef(0);

  const dismiss = useCallback((id: number) => setToasts((list) => list.filter((x) => x.id !== id)), []);
  const show = useCallback<ShowToast>(
    (message, kind = 'info', action) => {
      const id = ++nextId.current;
      setToasts((list) => [...list.slice(-(MAX_TOASTS - 1)), { id, message, kind, action }]);
      window.setTimeout(() => dismiss(id), action ? Math.max(ACTION_TOAST_MS, TOAST_MS[kind]) : TOAST_MS[kind]);
    },
    [dismiss],
  );

  return (
    <ToastContext.Provider value={show}>
      {children}
      <div className="toast-region hidden-print" role="status" aria-live="polite">
        {toasts.map((toast) => (
          <div key={toast.id} className={`toast ${toast.kind}`}>
            <Icon name={TOAST_ICON[toast.kind]} />
            <span className="toast-text">{toast.message}</span>
            {toast.action && (
              <button
                type="button"
                className="btn toast-action"
                onClick={() => {
                  dismiss(toast.id);
                  toast.action?.onClick();
                }}
              >
                {toast.action.icon && <Icon name={toast.action.icon} size={20} />}
                {toast.action.label}
              </button>
            )}
            <IconButton icon="close" label={t('common.dismiss')} className="ghost" onClick={() => dismiss(toast.id)} />
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
export function useToast(): ShowToast {
  return useContext(ToastContext);
}

/** Text input that commits on Enter/blur, reverts on Esc; used for renaming designs and colours. */
export function InlineEdit({
  id,
  value,
  onCommit,
  maxLength,
  ariaLabel,
  className,
}: {
  id?: string;
  value: string;
  onCommit: (v: string) => void;
  maxLength?: number;
  ariaLabel: string;
  className?: string;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const cancelled = useRef(false);

  const finish = () => {
    const next = draft?.trim();
    setDraft(null);
    if (cancelled.current) {
      cancelled.current = false;
      return;
    }
    if (next && next !== value) onCommit(next);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      e.currentTarget.blur();
    } else if (e.key === 'Escape') {
      // Keep Esc from also closing a surrounding dialog.
      e.preventDefault();
      e.stopPropagation();
      cancelled.current = true;
      e.currentTarget.blur();
    }
  };

  return (
    <input
      id={id}
      type="text"
      className={className ? `inline-edit ${className}` : 'inline-edit'}
      value={draft ?? value}
      maxLength={maxLength}
      aria-label={ariaLabel}
      title={ariaLabel}
      spellCheck={false}
      onFocus={(e) => {
        setDraft(value);
        e.currentTarget.select();
      }}
      onChange={(e) => setDraft(e.target.value)}
      onKeyDown={onKeyDown}
      onBlur={finish}
    />
  );
}

/** Copy text to clipboard with fallback (execCommand / prompt). Returns true on success. */
export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Permission denied or unsupported: fall through to the legacy path.
  }
  if (copyWithExecCommand(text)) return true;
  window.prompt(t('common.copyManually'), text);
  return false;
}

function copyWithExecCommand(text: string): boolean {
  // While a modal <dialog> is open the rest of the document is inert, so the helper must live inside it.
  const host = document.activeElement?.closest('dialog') ?? document.body;
  const area = document.createElement('textarea');
  area.value = text;
  area.setAttribute('readonly', '');
  area.style.position = 'fixed';
  area.style.opacity = '0';
  host.appendChild(area);
  area.select();
  try {
    return document.execCommand('copy');
  } catch {
    return false;
  } finally {
    area.remove();
  }
}

/** Links longer than this may be truncated by some messengers / mail clients. */
const LONG_URL = 2000;

/** Share dialog: shows the link (selectable input), Copy button, native navigator.share when available. */
export function ShareDialog({ open, url, title, onClose }: { open: boolean; url: string; title: string; onClose: () => void }) {
  return (
    <Modal open={open} title={t('common.shareTitle', { name: title })} onClose={onClose}>
      <ShareContent url={url} title={title} />
    </Modal>
  );
}

function ShareContent({ url, title }: { url: string; title: string }) {
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle');
  const canShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function';

  useEffect(() => {
    if (copyState === 'idle') return;
    const timer = window.setTimeout(() => setCopyState('idle'), 2500);
    return () => window.clearTimeout(timer);
  }, [copyState]);

  const copy = async () => setCopyState((await copyToClipboard(url)) ? 'copied' : 'failed');
  const share = () => navigator.share({ title, url }).catch(() => {}); // user cancelled: nothing to do

  return (
    <div className="stack share-dialog">
      <input
        type="text"
        readOnly
        className="share-url"
        value={url}
        aria-label={t('common.shareLink')}
        onFocus={(e) => e.currentTarget.select()}
      />
      <div className="toolbar">
        <button type="button" className="btn primary big" onClick={copy}>
          <Icon name={copyState === 'copied' ? 'check' : 'copy'} />
          {copyState === 'copied' ? t('common.copied') : t('common.copyLink')}
        </button>
        {canShare && (
          <button type="button" className="btn big" onClick={share}>
            <Icon name="share" />
            {t('common.shareVia')}
          </button>
        )}
      </div>
      {copyState === 'failed' && <p className="error">{t('common.copyFailed')}</p>}
      <p className="muted share-note">
        <Icon name="info" size={18} />
        {t('common.shareNote')}
      </p>
      {url.length > LONG_URL && (
        <p className="warning">
          <Icon name="warning" size={18} />
          {t('common.shareLongUrl')}
        </p>
      )}
    </div>
  );
}

// ---- Extra shared helpers (not part of the original stub contract) ----

/** Square icon-only button with the mandatory aria-label + tooltip. */
export function IconButton({
  icon,
  label,
  className,
  ...rest
}: { icon: IconName; label: string } & Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children' | 'aria-label' | 'title'>) {
  return (
    <button type="button" {...rest} className={className ? `btn icon ${className}` : 'btn icon'} aria-label={label} title={label}>
      <Icon name={icon} />
    </button>
  );
}

const OP_SYMBOLS: Record<Op, string> = { add: '+', sub: '−', mul: '×', div: '÷' };

/** Display symbol for an operation, honouring the design's printed × / ÷ symbols when given. */
export function opSymbol(op: Op, print?: Pick<PrintSettings, 'mulSymbol' | 'divSymbol'>): string {
  if (print && op === 'mul') return print.mulSymbol;
  if (print && op === 'div') return print.divSymbol;
  return OP_SYMBOLS[op];
}

/** Badge listing a puzzle's operations with the canonical glyphs "+ − × ÷" (the printed · / : are too faint here). */
export function OpsBadge({ ops }: { ops: Op[] }) {
  const symbols = ops.map((op) => opSymbol(op)).join(' ');
  return (
    <span className="badge ops-badge" title={t('common.operations')} aria-label={`${t('common.operations')}: ${symbols}`}>
      {symbols}
    </span>
  );
}

/** A badge has room for text only: picture sets show their name. */
const SET_GLYPHS: Partial<Record<SymbolSet, string>> = { numbers: '1 2 3', upper: 'A B C', lower: 'a b c' };

/** Badge of a design's kind of puzzle: its operations, or the symbol set of a simple puzzle. */
export function PuzzleBadge({ puzzle }: { puzzle: PuzzleSettings }) {
  if (!puzzle.simple?.on) return <OpsBadge ops={puzzle.ops} />;
  const { set } = puzzle.simple;
  const name = t(`symbols.set_${set}`);
  const label = t('symbols.badge', { set: name });
  return (
    <span className="badge simple-badge" title={label} aria-label={label}>
      {SET_GLYPHS[set] ?? name}
    </span>
  );
}

/** `data:` URI for an SVG string, usable as <img src>. */
export function svgDataUri(svg: string): string {
  // A lone surrogate in user text would make encodeURIComponent throw a URIError.
  const wellFormed = (svg as string & { toWellFormed?: () => string }).toWellFormed?.() ?? svg;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(wellFormed)}`;
}

/** Coloured picture of a design as a crisp <img> (memoised per design object). */
export function DesignPicture({ design, maxPx = 240, className }: { design: Design; maxPx?: number; className?: string }) {
  const cellPx = Math.max(2, Math.floor(maxPx / Math.max(design.width, design.height)));
  const src = useMemo(() => svgDataUri(renderDesignSVG(design, { cellPx })), [design, cellPx]);
  return (
    <img
      className={className ? `design-picture ${className}` : 'design-picture'}
      src={src}
      width={design.width * cellPx}
      height={design.height * cellPx}
      alt={design.name}
      draggable={false}
    />
  );
}
