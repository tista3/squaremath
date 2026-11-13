// Pixel-art editor for a design: draw on the grid, manage the palette and the picture size.
import { useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { Icon } from '../components/Icon';
import { ConfirmDialog, IconButton, InlineEdit, ShareDialog } from '../components/ui';
import { buildShareUrl } from '../core/codec';
import { NAME_MAX, type Design } from '../core/types';
import { t } from '../i18n';
import { GridCanvas } from './editor/GridCanvas';
import { DesignBackLink, DesignTabs } from './puzzle/DesignNav';
import { snapshotOf } from './editor/history';
import { cycleColorId, paintedCount, resolveSelected } from './editor/palette';
import { PalettePanel } from './editor/PalettePanel';
import { SizeDialog } from './editor/SizeDialog';
import { SwatchStrip } from './editor/SwatchStrip';
import { ToolPanel, ZOOM_LEVELS } from './editor/ToolPanel';
import { shortcutFor, shouldIgnoreShortcut, type Shortcut, type Tool } from './editor/tools';
import { useEditHistory, type EditHistory } from './editor/useEditHistory';
import { useStroke } from './editor/useStroke';
import type { DesignPageProps } from './types';
import './EditorPage.css';

/**
 * Editor for the user's own designs. Shared designs never reach it (App only routes their puzzle and solve
 * pages), so a missing onChange is a routing mistake: fall back to the design's landing page.
 */
export default function EditorPage({ design, basePath, onChange }: DesignPageProps) {
  if (!onChange) return <Navigate to={basePath} replace />;
  // Keyed so undo history and tool state never leak between designs.
  return <Editor key={design.id} design={design} basePath={basePath} onChange={onChange} />;
}

function EditorHeader({ design, basePath, onRename }: { design: Design; basePath: string; onRename: (name: string) => void }) {
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  return (
    <header className="page-header ed-header">
      <h1 className="visually-hidden">{design.name}</h1>
      <DesignBackLink basePath={basePath} readOnly={false} />
      <label className="ed-title-wrap">
        <InlineEdit className="ed-title" value={design.name} maxLength={NAME_MAX} ariaLabel={t('editor.designName')} onCommit={onRename} />
        <Icon name="edit" size={18} className="ed-title-pencil" />
      </label>
      <IconButton icon="share" label={t('common.share')} onClick={() => setShareUrl(buildShareUrl(design))} />
      <ShareDialog open={shareUrl !== null} url={shareUrl ?? ''} title={design.name} onClose={() => setShareUrl(null)} />
      <DesignTabs design={design} basePath={basePath} current="edit" readOnly={false} />
    </header>
  );
}

interface EditorProps {
  design: Design;
  basePath: string;
  onChange: (updater: (d: Design) => Design) => void;
}

function Editor({ design, basePath, onChange }: EditorProps) {
  const [tool, setTool] = useState<Tool>('pencil');
  const [selected, setSelected] = useState<string | null>(null);
  const [zoomIndex, setZoomIndex] = useState(0);
  const [showGrid, setShowGrid] = useState(true);
  const [dialog, setDialog] = useState<'size' | 'clear' | null>(null);
  const selectedId = resolveSelected(design.palette, design.backgroundId, selected);
  const selectedColor = design.palette.find((c) => c.id === selectedId)!;
  const history = useEditHistory(design, onChange);
  const commitCells = (cells: string[]) => history.commit({ ...snapshotOf(design), cells });
  const { draft, handlers } = useStroke({
    design,
    tool,
    colorId: selectedId,
    commitCells,
    pick: (id) => {
      setSelected(id);
      setTool('pencil');
    },
  });

  useShortcuts((s) => {
    if (s.kind === 'tool') setTool(s.tool);
    else if (s.kind === 'undo') history.undo();
    else if (s.kind === 'redo') history.redo();
    else if (s.kind === 'color') setSelected(design.palette[s.index]?.id ?? selectedId);
    else setSelected(cycleColorId(design.palette, selectedId, s.step));
  }, draft === null);

  const rename = (value: string) => {
    const name = value.trim().slice(0, NAME_MAX);
    if (name) onChange((d) => ({ ...d, name }));
  };

  return (
    <div className="page ed-page">
      <EditorHeader design={design} basePath={basePath} onRename={rename} />
      <div className="ed-layout">
        <ToolPanel
          tool={tool}
          onTool={setTool}
          color={selectedColor}
          canUndo={history.canUndo}
          canRedo={history.canRedo}
          onUndo={history.undo}
          onRedo={history.redo}
          zoomIndex={zoomIndex}
          onZoom={setZoomIndex}
          showGrid={showGrid}
          onToggleGrid={() => setShowGrid(!showGrid)}
          onResize={() => setDialog('size')}
          canClear={paintedCount(design) > 0}
          onClear={() => setDialog('clear')}
        />
        <div className="ed-canvas-area">
          <GridCanvas
            cols={design.width}
            rows={design.height}
            cells={draft ?? design.cells}
            palette={design.palette}
            showGrid={showGrid}
            zoom={ZOOM_LEVELS[zoomIndex]}
            label={t('editor.canvasLabel', { width: design.width, height: design.height })}
            stroke={handlers}
          >
            {zoomIndex > 0 && <p className="muted ed-pan-hint">{t('editor.panHint')}</p>}
            <SwatchStrip design={design} selectedId={selectedId} onSelect={setSelected} />
          </GridCanvas>
        </div>
        <PalettePanel design={design} basePath={basePath} selectedId={selectedId} onSelect={setSelected} commit={history.commit} />
      </div>
      {dialog === 'size' && (
        <SizeDialog
          design={design}
          onClose={() => setDialog(null)}
          onApply={(next) => {
            history.commit(next);
            setDialog(null);
          }}
        />
      )}
      <ClearDialog open={dialog === 'clear'} design={design} history={history} onClose={() => setDialog(null)} />
    </div>
  );
}

function ClearDialog({ open, design, history, onClose }: { open: boolean; design: Design; history: EditHistory; onClose(): void }) {
  const background = design.palette.find((c) => c.id === design.backgroundId);
  return (
    <ConfirmDialog
      open={open}
      title={t('editor.clearTitle')}
      message={t('editor.clearMessage', { name: background?.name ?? '' })}
      confirmLabel={t('editor.clearConfirm')}
      danger
      onConfirm={() => {
        history.commit({ ...snapshotOf(design), cells: design.cells.map(() => design.backgroundId) });
        onClose();
      }}
      onCancel={onClose}
    />
  );
}

/** Global editor shortcuts; ignored while typing, while a dialog is open, or (enabled=false) mid-stroke. */
function useShortcuts(onShortcut: (s: Shortcut) => void, enabled: boolean) {
  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat && !(e.ctrlKey || e.metaKey)) return;
      if (shouldIgnoreShortcut(e)) return;
      const s = shortcutFor(e);
      if (!s) return;
      e.preventDefault();
      onShortcut(s);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onShortcut, enabled]);
}
