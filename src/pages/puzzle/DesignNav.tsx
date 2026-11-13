// Navigation shared by a design's Puzzle and Solve pages: back (gallery, or the shared-link landing
// page), the design's pages as icon tabs (Draw / Puzzle & print / Solve), and the Share dialog state.
import { useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Icon, type IconName } from '../../components/Icon';
import { ShareDialog, useToast } from '../../components/ui';
import { buildShareUrl } from '../../core/codec';
import type { Design } from '../../core/types';
import { t } from '../../i18n';
import { routes, type DesignSubPage } from '../../routes';
import { carriedState } from './settings';
import './DesignNav.css';

interface Props {
  design: Design;
  /** "/d/<id>" (own design) or "/s/<payload>" (shared link). */
  basePath: string;
  current: DesignSubPage;
  /** Shared design: no Draw tab; settings travel along in the router state. */
  readOnly: boolean;
}

interface TabsProps extends Props {
  /** Icons only (labels stay as accessible names): for crowded toolbars. */
  compact?: boolean;
}

const TABS: { page: DesignSubPage; icon: IconName }[] = [
  { page: 'edit', icon: 'pencil' },
  { page: 'puzzle', icon: 'print' },
  { page: 'solve', icon: 'play' },
];

/** Back to where the design came from: the gallery, or the landing page of a shared link. */
export function DesignBackLink({ basePath, readOnly }: Pick<Props, 'basePath' | 'readOnly'>) {
  const label = readOnly ? t('puzzle.navBackShared') : t('puzzle.navBack');
  return (
    <Link to={readOnly ? basePath : routes.gallery()} className="btn icon design-nav-back" aria-label={label} title={label}>
      <Icon name="back" />
    </Link>
  );
}

/** The design's pages as tabs; the current one is marked, labels hide on narrow screens. */
export function DesignTabs({ design, basePath, current, readOnly, compact }: TabsProps) {
  const state = readOnly ? carriedState(design) : undefined;
  return (
    <nav className={`design-nav seg hidden-print${compact ? ' compact' : ''}`} aria-label={t('puzzle.navLabel')}>
      {TABS.filter((tab) => !(readOnly && tab.page === 'edit')).map(({ page, icon }) => {
        const here = page === current;
        return (
          <Link
            key={page}
            to={routes.sub(basePath, page)}
            state={state}
            className={`btn${here ? ' active' : ''}`}
            aria-current={here ? 'page' : undefined}
            title={t(`puzzle.nav_${page}`)}
          >
            <Icon name={icon} /> <span className="design-nav-label">{t(`puzzle.nav_${page}`)}</span>
          </Link>
        );
      })}
    </nav>
  );
}

/** Share dialog state for a design: `open()` builds the link and shows the dialog. */
export function useShareDialog(design: Design): { open: () => void; dialog: ReactNode } {
  const toast = useToast();
  const [url, setUrl] = useState<string | null>(null);
  const open = () => {
    try {
      setUrl(buildShareUrl(design));
    } catch (err) {
      console.error('buildShareUrl failed', err);
      toast(t('puzzle.shareFailed'), 'error');
    }
  };
  const dialog = <ShareDialog open={url !== null} url={url ?? ''} title={design.name} onClose={() => setUrl(null)} />;
  return { open, dialog };
}
