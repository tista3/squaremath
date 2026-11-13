// Tools column (desktop) / one row (phone): drawing tools, history, zoom, grid lines, size and clear. On
// phones the less-used tools (zoom, grid lines, size, clear) sit behind a "more" toggle so the row fits.
import { useState, type ReactNode } from 'react';
import { Icon } from '../../components/Icon';
import type { PaletteColor } from '../../core/types';
import { t } from '../../i18n';
import { TOOLS, type Tool } from './tools';
import { MoreIcon } from './MoreIcon';

export const ZOOM_LEVELS = [1, 1.5, 2, 3, 4];

const IS_APPLE = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
/** Shortcut keys as the platform spells them (⌘ on Apple devices, Ctrl elsewhere). */
const SHORTCUT_KEYS = IS_APPLE ? { mod: '⌘', redoKey: '⌘+Shift+Z' } : { mod: 'Ctrl', redoKey: 'Ctrl+Y' };

interface Props {
  tool: Tool;
  onTool(tool: Tool): void;
  color: PaletteColor;
  canUndo: boolean;
  canRedo: boolean;
  onUndo(): void;
  onRedo(): void;
  zoomIndex: number;
  onZoom(index: number): void;
  showGrid: boolean;
  onToggleGrid(): void;
  onResize(): void;
  canClear: boolean;
  onClear(): void;
}

/** Big tool button with a pressed / expanded state (the shared IconButton has neither). */
function ToolButton(props: {
  label: string;
  onClick(): void;
  active?: boolean;
  disabled?: boolean;
  className?: string;
  expanded?: boolean;
  controls?: string;
  children: ReactNode;
}) {
  const classes = ['btn icon big', props.active && 'active', props.className].filter(Boolean).join(' ');
  return (
    <button
      type="button"
      className={classes}
      aria-label={props.label}
      title={props.label}
      aria-pressed={props.expanded === undefined ? props.active : undefined}
      aria-expanded={props.expanded}
      aria-controls={props.controls}
      disabled={props.disabled}
      onClick={props.onClick}
    >
      {props.children}
    </button>
  );
}

export function ToolPanel(p: Props) {
  const [moreOpen, setMoreOpen] = useState(false);
  return (
    <div className={moreOpen ? 'ed-tools more-open' : 'ed-tools'} role="toolbar" aria-label={t('editor.tools')}>
      <div className="ed-tool-group ed-draw-tools">
        <span
          className="swatch ed-current"
          style={{ background: p.color.hex }}
          role="img"
          aria-label={t('editor.currentColor', { name: p.color.name })}
          title={t('editor.currentColor', { name: p.color.name })}
        />
        {TOOLS.map(({ tool, icon: name, key }) => (
          <ToolButton key={tool} label={t(`editor.tool.${tool}`, { key })} active={p.tool === tool} onClick={() => p.onTool(tool)}>
            <Icon name={name} />
          </ToolButton>
        ))}
      </div>
      <div className="ed-tool-group">
        <ToolButton label={t('editor.undo', SHORTCUT_KEYS)} disabled={!p.canUndo} onClick={p.onUndo}><Icon name="undo" /></ToolButton>
        <ToolButton label={t('editor.redo', SHORTCUT_KEYS)} disabled={!p.canRedo} onClick={p.onRedo}><Icon name="redo" /></ToolButton>
      </div>
      <ToolButton
        label={t('editor.moreTools')}
        className="ed-more"
        active={moreOpen}
        expanded={moreOpen}
        controls="ed-more-tools"
        onClick={() => setMoreOpen(!moreOpen)}
      >
        <MoreIcon />
      </ToolButton>
      <div id="ed-more-tools" className="ed-more-tools">
        <div className="ed-tool-group">
          <ToolButton label={t('editor.zoomIn')} disabled={p.zoomIndex >= ZOOM_LEVELS.length - 1} onClick={() => p.onZoom(p.zoomIndex + 1)}>
            <Icon name="zoomIn" />
          </ToolButton>
          <ToolButton label={t('editor.zoomOut')} disabled={p.zoomIndex <= 0} onClick={() => p.onZoom(p.zoomIndex - 1)}>
            <Icon name="zoomOut" />
          </ToolButton>
          <ToolButton label={t('editor.zoomFit')} disabled={p.zoomIndex === 0} onClick={() => p.onZoom(0)}>
            <Icon name="fit" />
          </ToolButton>
          <ToolButton label={t('editor.gridLines')} active={p.showGrid} onClick={p.onToggleGrid}><Icon name="grid" /></ToolButton>
        </div>
        <div className="ed-tool-group">
          <ToolButton label={t('editor.resize')} onClick={p.onResize}><Icon name="resize" /></ToolButton>
          <ToolButton label={t('editor.clear')} disabled={!p.canClear} onClick={p.onClear}><Icon name="clear" /></ToolButton>
        </div>
      </div>
    </div>
  );
}
