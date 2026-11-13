import type { Design } from '../core/types';

/** Props every design page (Editor / Puzzle / Solve) receives from the route wrapper in App.tsx. */
export interface DesignPageProps {
  design: Design;
  /** Route prefix of this design's pages: "/d/<id>" (own) or "/s/<payload>" (shared). Use routes.sub(basePath, 'solve'). */
  basePath: string;
  /** Present for the user's own designs (persists via the store). Absent => read-only shared design. */
  onChange?: (updater: (d: Design) => Design) => void;
  /** Present for read-only shared designs: persists a copy to the library and returns the new id. */
  onSaveCopy?: () => string;
}
