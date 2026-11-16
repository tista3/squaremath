// OWNER: shell agent. HashRouter + providers + route wrappers (see src/routes.ts).
import { Component, lazy, Suspense, useCallback, useEffect, useMemo, useState, type ComponentType, type ReactNode } from 'react';
import { HashRouter, Link, Navigate, Outlet, Route, Routes, useLocation, useParams } from 'react-router-dom';
import { decodeDesign } from './core/codec';
import type { Design } from './core/types';
import { t } from './i18n';
import { Icon, type IconName } from './components/Icon';
import { downloadLibrary, findCopyOf } from './components/library';
import { IconButton, ToastProvider } from './components/ui';
import GalleryPage from './pages/GalleryPage';
import SharedPage from './pages/SharedPage';
import type { DesignPageProps } from './pages/types';
import { routes, type DesignSubPage } from './routes';
import { DesignStoreProvider, STORAGE_ERRORS, useDesignStore } from './state/store';

const PAGES: Record<DesignSubPage, ComponentType<DesignPageProps>> = {
  edit: lazy(() => import('./pages/EditorPage')),
  puzzle: lazy(() => import('./pages/PuzzlePage')),
  solve: lazy(() => import('./pages/SolvePage')),
};
const PhotoPage = lazy(() => import('./pages/PhotoPage'));
const SHARED_SUBPAGES: DesignSubPage[] = ['puzzle', 'solve'];
const APP_NAME = 'SquareMath';

export default function App() {
  return (
    <HashRouter>
      <DesignStoreProvider>
        <ToastProvider>
          <AppRoutes />
        </ToastProvider>
      </DesignStoreProvider>
    </HashRouter>
  );
}

function AppRoutes() {
  const { pathname } = useLocation();
  // Outer boundary: an error in the layout itself (top bar, banner, its effects) shows a notice, not a blank page.
  return (
    <ErrorBoundary resetKey={pathname}>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<GalleryRoute />} />
          <Route path="photo" element={<PhotoRoute />} />
          <Route path="d/:id/:page" element={<OwnDesignRoute />} />
          <Route path="s/:payload" element={<SharedLandingRoute />} />
          <Route path="s/:payload/:page" element={<SharedDesignRoute />} />
          <Route path="*" element={<Navigate to={routes.gallery()} replace />} />
        </Route>
      </Routes>
    </ErrorBoundary>
  );
}

function Layout() {
  const { pathname } = useLocation();
  // Block body on purpose: an effect must return nothing or a cleanup function, and in some browsers
  // window.scrollTo() returns a Promise, which React would later call as the cleanup.
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);
  return (
    <>
      <TopBar />
      <StorageBanner />
      <main className="app-main">
        <ErrorBoundary resetKey={pathname}>
          <Suspense fallback={<Loading />}>
            <Outlet />
          </Suspense>
        </ErrorBoundary>
      </main>
    </>
  );
}

function TopBar() {
  return (
    <header className="topbar hidden-print">
      <Link to={routes.gallery()} className="brand" title={t('common.home')}>
        <LogoMark />
        <span>{APP_NAME}</span>
      </Link>
    </header>
  );
}

const LOGO_COLORS = ['#e63946', '#ffd166', '#06d6a0', '#118ab2', '#ffffff', '#e63946', '#ffd166', '#06d6a0', '#118ab2'];

function LogoMark() {
  return (
    <svg className="brand-mark" viewBox="0 0 32 32" aria-hidden="true" focusable="false">
      <rect width="32" height="32" rx="7" fill="#ffffff" />
      {LOGO_COLORS.map((fill, i) => (
        <rect
          key={i}
          x={4 + (i % 3) * 8}
          y={4 + Math.floor(i / 3) * 8}
          width="8"
          height="8"
          fill={fill}
          stroke="#2b2b3a"
          strokeWidth="1"
        />
      ))}
    </svg>
  );
}

/**
 * Warns when designs cannot be saved. Dismissing hides it only for the current error on the current page:
 * it comes back on the next page and whenever saving fails again after it had recovered.
 */
function StorageBanner() {
  const { storageError, designs } = useDesignStore();
  const { pathname } = useLocation();
  const [dismissed, setDismissed] = useState<{ error: string; pathname: string } | null>(null);
  if (!storageError && dismissed) setDismissed(null); // saving works again: forget the dismissal
  if (!storageError || (dismissed?.error === storageError && dismissed.pathname === pathname)) return null;
  return (
    <div className="banner hidden-print" role="alert">
      <Icon name="warning" />
      <p className="banner-text">{storageErrorText(storageError)}</p>
      <button
        type="button"
        className="btn"
        disabled={designs.length === 0}
        title={t('common.exportLibraryHint')}
        onClick={() => downloadLibrary(designs)}
      >
        <Icon name="download" />
        {t('common.exportLibrary')}
      </button>
      <IconButton
        icon="close"
        label={t('common.dismiss')}
        className="ghost"
        onClick={() => setDismissed({ error: storageError, pathname })}
      />
    </div>
  );
}

/** The store reports English sentences; show the translated variant when it is a known one. */
function storageErrorText(message: string): string {
  if (message === STORAGE_ERRORS.quota) return t('common.storageQuota');
  if (message === STORAGE_ERRORS.unavailable) return t('common.storageUnavailable');
  if (message === STORAGE_ERRORS.recovered) return t('common.storageRecovered');
  if (message === STORAGE_ERRORS.damaged) return t('common.storageDamaged');
  if (message === STORAGE_ERRORS.newerVersion) return t('common.storageNewerVersion');
  return message;
}

function useDocumentTitle(title?: string) {
  useEffect(() => {
    document.title = title ? `${title} · ${APP_NAME}` : APP_NAME;
  }, [title]);
}

function GalleryRoute() {
  useDocumentTitle();
  return <GalleryPage />;
}

function PhotoRoute() {
  useDocumentTitle(t('photo.title'));
  return <PhotoPage />;
}

function isSubPage(page: string | undefined, allowed: DesignSubPage[]): page is DesignSubPage {
  return allowed.includes(page as DesignSubPage);
}

function OwnDesignRoute() {
  const { id = '', page } = useParams();
  const store = useDesignStore();
  const design = store.get(id);
  const onChange = useCallback((updater: (d: Design) => Design) => store.update(id, updater), [store, id]);
  useDocumentTitle(design?.name ?? t('common.notFoundTitle'));

  if (!isSubPage(page, ['edit', 'puzzle', 'solve'])) return <Navigate to={routes.design(id, 'edit')} replace />;
  if (!design) return <Notice icon="info" title={t('common.notFoundTitle')} text={t('common.notFoundText')} />;
  const Page = PAGES[page];
  return <Page key={id} design={design} basePath={`/d/${encodeURIComponent(id)}`} onChange={onChange} />;
}

// One-entry cache: landing page and its sub-pages share the decoded design (stable object identity).
let lastDecoded: { payload: string; design: Design | null } | null = null;

function decodeCached(payload: string): Design | null {
  if (lastDecoded?.payload !== payload) {
    let design: Design | null;
    try {
      design = decodeDesign(payload);
    } catch {
      design = null;
    }
    lastDecoded = { payload, design };
  }
  return lastDecoded.design;
}

function useSharedDesign(): { payload: string; design: Design | null } {
  const { payload = '' } = useParams();
  const design = useMemo(() => decodeCached(payload), [payload]);
  useDocumentTitle(design?.name ?? t('common.brokenLinkTitle'));
  return { payload, design };
}

function BrokenLink() {
  return <Notice icon="link" title={t('common.brokenLinkTitle')} text={t('common.brokenLinkText')} />;
}

function SharedLandingRoute() {
  const { payload, design } = useSharedDesign();
  if (!design) return <BrokenLink />;
  return <SharedPage design={design} payload={payload} />;
}

function SharedDesignRoute() {
  const { page } = useParams();
  const { payload, design } = useSharedDesign();
  const store = useDesignStore();
  // Reuse an unchanged copy saved earlier rather than adding another identical one.
  const onSaveCopy = useCallback(
    () => (design ? (findCopyOf(store.designs, design) ?? store.saveCopy(design)).id : ''),
    [store, design],
  );

  if (!design) return <BrokenLink />;
  if (!isSubPage(page, SHARED_SUBPAGES)) return <Navigate to={routes.shared(payload)} replace />;
  const Page = PAGES[page];
  return <Page key={payload} design={design} basePath={routes.shared(payload)} onSaveCopy={onSaveCopy} />;
}

function Notice({ icon, title, text, children }: { icon: IconName; title: string; text: string; children?: ReactNode }) {
  return (
    <div className="center-screen">
      <Icon name={icon} size={64} />
      <h1>{title}</h1>
      <p className="muted">{text}</p>
      <div className="toolbar">
        {children}
        <Link to={routes.gallery()} className="btn primary big">
          <Icon name="home" />
          {t('common.home')}
        </Link>
      </div>
    </div>
  );
}

function Loading() {
  return (
    <div className="center-screen" aria-busy="true">
      <div className="spinner" />
      <span className="visually-hidden">{t('common.loading')}</span>
    </div>
  );
}

/** Catches render/effect errors (and failed lazy chunk loads) below it; resets when the route changes. */
class ErrorBoundary extends Component<{ resetKey: string; children: ReactNode }, { failed: boolean; key: string }> {
  state = { failed: false, key: this.props.resetKey };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  static getDerivedStateFromProps(props: { resetKey: string }, state: { failed: boolean; key: string }) {
    return props.resetKey === state.key ? null : { failed: false, key: props.resetKey };
  }

  componentDidCatch(error: unknown) {
    console.error(error);
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <Notice icon="warning" title={t('common.errorTitle')} text={t('common.errorText')}>
        <button type="button" className="btn big" onClick={() => window.location.reload()}>
          <Icon name="refresh" />
          {t('common.reload')}
        </button>
      </Notice>
    );
  }
}
