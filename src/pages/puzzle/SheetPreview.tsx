import { useMemo } from 'react';
import { svgDataUri } from '../../components/ui';
import type { Design } from '../../core/types';
import { t } from '../../i18n';
import { renderSheetPages, type OkPuzzle, type SheetKind } from '../../render/sheet';

export type { SheetKind };

/** The printable sheet as images, one per printed page (big grids are split), scaled to fit the container. */
export function SheetPreview({ design, puzzle, kind }: { design: Design; puzzle: OkPuzzle; kind: SheetKind }) {
  const pages = useMemo(() => {
    try {
      return renderSheetPages(design, puzzle, kind).map(svgDataUri);
    } catch (err) {
      console.error('renderSheetPages failed', err);
      return null;
    }
  }, [design, puzzle, kind]);

  if (!pages || pages.length === 0) return <p className="error">{t('puzzle.previewFailed')}</p>;
  const alt = t(kind === 'puzzle' ? 'puzzle.previewAltPuzzle' : 'puzzle.previewAltSolution', { name: design.name });
  return (
    <div className="puzzle-sheet-wrap puzzle-sheet-pages">
      {pages.map((src, i) => (
        <img key={i} className="puzzle-sheet" src={src} alt={pages.length > 1 ? `${alt} (${i + 1}/${pages.length})` : alt} />
      ))}
    </div>
  );
}
