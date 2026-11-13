import { useEffect, useMemo, useRef, type CSSProperties } from 'react';
import { Icon } from '../../components/Icon';
import type { Design } from '../../core/types';
import { t } from '../../i18n';
import { renderDesignSVG } from '../../render/sheet';
import { svgDataUri } from '../../components/ui';

const CONFETTI_COUNT = 48;
const FESTIVE = ['#f43f5e', '#f59e0b', '#22c55e', '#3b82f6', '#a855f7', '#facc15'];

interface Piece {
  color: string;
  style: CSSProperties;
}

/** Deterministic spread (golden-ratio sequence) so confetti looks random without re-rolling per render. */
function confetti(colors: string[]): Piece[] {
  const pool = [...FESTIVE, ...colors];
  return Array.from({ length: CONFETTI_COUNT }, (_, i) => {
    const f = (n: number) => ((i + 1) * n) % 1;
    return {
      color: pool[i % pool.length],
      style: {
        '--x': `${(f(0.618034) * 100).toFixed(1)}%`,
        '--delay': `${(f(0.414214) * 1.6).toFixed(2)}s`,
        '--dur': `${(2.4 + f(0.732051) * 2).toFixed(2)}s`,
        '--spin': `${Math.round(360 + f(0.236068) * 720)}deg`,
        '--drift': `${Math.round((f(0.302776) - 0.5) * 160)}px`,
      } as CSSProperties,
    };
  });
}

interface Props {
  design: Design;
  printing: boolean;
  /** Shown inside the card: toasts would be hidden under the modal dialog. */
  printError: string | null;
  onClose: () => void;
  onGallery: () => void;
  onPrint: () => void;
  onShare: () => void;
  onAgain: () => void;
}

/**
 * "Well done" dialog. A native modal <dialog> (like the shared Modal): top layer, inert page behind it,
 * focus returns to where it was on close. Confetti is decoration inside the full-screen dialog.
 */
export function Celebration({ design, printing, printError, onClose, onGallery, onPrint, onShare, onAgain }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const againRef = useRef<HTMLButtonElement>(null);
  const picture = useMemo(() => {
    try {
      return svgDataUri(renderDesignSVG(design, { cellPx: 16 }));
    } catch (err) {
      console.error('renderDesignSVG failed', err);
      return null;
    }
  }, [design]);
  const pieces = useMemo(() => confetti(design.palette.map((c) => c.hex)), [design.palette]);

  useEffect(() => {
    const dialog = ref.current!;
    if (typeof dialog.showModal === 'function') dialog.showModal();
    else dialog.setAttribute('open', '');
    againRef.current?.focus();
    return () => {
      if (typeof dialog.close === 'function') dialog.close();
      else dialog.removeAttribute('open');
    };
  }, []);

  return (
    <dialog
      ref={ref}
      className="solve-celebrate"
      aria-labelledby="solve-celebrate-title"
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      // The browser may still force-close it (repeated Esc): keep the parent's state in sync. A close
      // event from an earlier close() (StrictMode effect re-run) arrives while it is open again: ignore.
      onClose={() => {
        if (!ref.current?.open) onClose();
      }}
    >
      <div className="solve-confetti" aria-hidden="true">
        {pieces.map((p, i) => (
          <span key={i} style={{ ...p.style, background: p.color }} />
        ))}
      </div>
      <div className="panel solve-celebrate-card">
        <button type="button" className="btn icon ghost solve-celebrate-close" aria-label={t('solve.close')} title={t('solve.close')} onClick={onClose}>
          <Icon name="close" />
        </button>
        <div className="solve-stars" aria-hidden="true">
          <Icon name="star" size={36} />
          <Icon name="star" size={52} />
          <Icon name="star" size={36} />
        </div>
        <h2 id="solve-celebrate-title">{t('solve.wellDone')}</h2>
        {picture && <img className="solve-celebrate-picture" src={picture} alt={design.name} />}
        <div className="solve-celebrate-actions">
          <button type="button" className="btn big" onClick={onGallery}>
            <Icon name="home" /> {t('solve.toGallery')}
          </button>
          <button type="button" className="btn big" disabled={printing} aria-busy={printing} onClick={onPrint}>
            <Icon name="print" /> {t('solve.print')}
          </button>
          <button type="button" className="btn big" onClick={onShare}>
            <Icon name="share" /> {t('solve.share')}
          </button>
          <button ref={againRef} type="button" className="btn big primary" onClick={onAgain}>
            <Icon name="refresh" /> {t('solve.again')}
          </button>
        </div>
        {printError && (
          <p className="error solve-celebrate-error" role="alert">
            <Icon name="warning" size={20} /> {printError}
          </p>
        )}
      </div>
    </dialog>
  );
}
