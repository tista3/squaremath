// OWNER: photo-ui agent. Step 1: a big drop zone, choose / camera buttons and paste hint.
import { useId, useRef, type ChangeEvent } from 'react';
import { IMAGE_ACCEPT } from '../../core/image/load';
import { Icon } from '../../components/Icon';
import { t } from '../../i18n';

/** "⌘V" on Apple devices, "Ctrl+V" elsewhere. */
function pasteShortcut(): string {
  const platform = typeof navigator === 'undefined' ? '' : navigator.platform || navigator.userAgent;
  return /Mac|iPhone|iPad|iPod/.test(platform) ? '⌘V' : 'Ctrl+V';
}

/** Hidden file input + the function that opens it; the input's value is cleared so the same file can be re-picked. */
export function useFileInput(onFile: (file: File) => void) {
  const ref = useRef<HTMLInputElement>(null);
  const onChange = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (file) onFile(file);
  };
  return { ref, onChange, open: () => ref.current?.click() };
}

export function PhotoPicker({ dragActive, onFile }: { dragActive: boolean; onFile: (file: File) => void }) {
  const picker = useFileInput(onFile);
  const camera = useFileInput(onFile);
  const hintId = useId();

  return (
    <div className="stack photo-picker">
      <button
        type="button"
        className={`photo-drop${dragActive ? ' drag-active' : ''}`}
        onClick={picker.open}
        aria-describedby={hintId}
        data-step-heading
      >
        <Icon name="image" size={64} />
        <span className="photo-drop-title">{dragActive ? t('photo.dropActive') : t('photo.dropTitle')}</span>
        <span id={hintId} className="muted photo-drop-hint">
          {t('photo.dropHint', { paste: pasteShortcut() })}
        </span>
      </button>
      <div className="toolbar photo-picker-buttons">
        <button type="button" className="btn primary big" onClick={picker.open}>
          <Icon name="upload" />
          {t('photo.choose')}
        </button>
        {/* Phones and tablets only (CSS): desktop browsers ignore `capture` and would just show the file picker again. */}
        <button type="button" className="btn big photo-camera" onClick={camera.open}>
          <Icon name="camera" />
          {t('photo.camera')}
        </button>
      </div>
      <input ref={picker.ref} type="file" accept={IMAGE_ACCEPT} hidden aria-label={t('photo.choose')} onChange={picker.onChange} />
      <input
        ref={camera.ref}
        type="file"
        accept="image/*"
        capture="environment"
        hidden
        aria-label={t('photo.camera')}
        onChange={camera.onChange}
      />
    </div>
  );
}
