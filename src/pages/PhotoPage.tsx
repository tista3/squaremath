// OWNER: photo-ui agent. "Make a design from a photo": pick → automatic analysis + layouts → fine-tune → create.
// Everything happens in this tab: the photo is decoded and converted locally and never uploaded or stored.
import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { conversionToDesign } from '../core/image/pipeline';
import type { Conversion } from '../core/image/types';
import { Icon } from '../components/Icon';
import { useToast } from '../components/ui';
import { t } from '../i18n';
import { routes } from '../routes';
import { useDesignStore } from '../state/store';
import { dragHasFiles, pickFile } from './photo/helpers';
import { PhotoLayouts } from './photo/PhotoLayouts';
import { PhotoPicker } from './photo/PhotoPicker';
import { PhotoTuner } from './photo/PhotoTuner';
import { PhotoError, preparePhoto, type PhotoErrorCode, type PhotoSource, type PresetView } from './photo/prepare';
import './PhotoPage.css';

type Stage =
  | { step: 'pick'; error?: PhotoErrorCode }
  | { step: 'loading' }
  | { step: 'layouts'; source: PhotoSource }
  | { step: 'tune'; source: PhotoSource; view: PresetView };

const ERROR_TEXT: Record<PhotoErrorCode, string> = {
  notImage: 'photo.errorNotImage',
  decode: 'photo.errorDecode',
  analyse: 'photo.errorAnalyse',
};

export default function PhotoPage() {
  const [stage, setStage] = useState<Stage>({ step: 'pick' });
  const [name, setName] = useState('');
  const [dragActive, setDragActive] = useState(false);
  const loadToken = useRef(0);
  const pageRef = useRef<HTMLDivElement>(null);
  const store = useDesignStore();
  const toast = useToast();
  const navigate = useNavigate();
  const acceptsFiles = stage.step === 'pick' || stage.step === 'layouts';

  const loadFile = useCallback(async (file: File) => {
    const token = ++loadToken.current;
    const isStale = () => loadToken.current !== token;
    setStage({ step: 'loading' });
    try {
      const source = await preparePhoto(file, t('photo.defaultName'), isStale);
      if (!source || isStale()) return;
      setName(source.name);
      setStage({ step: 'layouts', source });
    } catch (error) {
      if (isStale()) return;
      if (!(error instanceof PhotoError)) console.error(error);
      setStage({ step: 'pick', error: error instanceof PhotoError ? error.code : 'analyse' });
    }
  }, []);

  // Stop a load still in progress when leaving the page.
  useEffect(() => () => void ++loadToken.current, []);

  // Paste an image (Ctrl+V / ⌘V) while choosing a photo or a layout; text pastes (e.g. into the name) pass through.
  useEffect(() => {
    if (!acceptsFiles) return;
    const onPaste = (e: ClipboardEvent) => {
      const file = pickFile(e.clipboardData);
      if (!file) return;
      e.preventDefault();
      void loadFile(file);
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [acceptsFiles, loadFile]);

  // Drag & drop anywhere on the window. Dropped files are always caught, so a missed drop never makes the
  // browser leave the app to show the image.
  useEffect(() => {
    let depth = 0;
    const onEnter = (e: DragEvent) => {
      if (!dragHasFiles(e.dataTransfer?.types)) return;
      depth++;
      if (acceptsFiles) setDragActive(true);
    };
    const onLeave = (e: DragEvent) => {
      if (!dragHasFiles(e.dataTransfer?.types)) return;
      depth = Math.max(0, depth - 1);
      if (depth === 0) setDragActive(false);
    };
    const onOver = (e: DragEvent) => {
      if (!dragHasFiles(e.dataTransfer?.types)) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = acceptsFiles ? 'copy' : 'none';
    };
    const onDrop = (e: DragEvent) => {
      if (!dragHasFiles(e.dataTransfer?.types)) return;
      e.preventDefault();
      depth = 0;
      setDragActive(false);
      const file = pickFile(e.dataTransfer);
      if (acceptsFiles && file) void loadFile(file);
    };
    window.addEventListener('dragenter', onEnter);
    window.addEventListener('dragleave', onLeave);
    window.addEventListener('dragover', onOver);
    window.addEventListener('drop', onDrop);
    return () => {
      window.removeEventListener('dragenter', onEnter);
      window.removeEventListener('dragleave', onLeave);
      window.removeEventListener('dragover', onOver);
      window.removeEventListener('drop', onDrop);
      setDragActive(false);
    };
  }, [acceptsFiles, loadFile]);

  // After a step change, start at the top and move focus to the new step's heading (keyboard / screen readers).
  const firstStep = useRef(true);
  useEffect(() => {
    if (firstStep.current) {
      firstStep.current = false;
      return;
    }
    if (stage.step === 'loading') return;
    window.scrollTo(0, 0);
    pageRef.current?.querySelector<HTMLElement>('[data-step-heading]')?.focus({ preventScroll: true });
  }, [stage]);

  const create = (conversion: Conversion) => {
    const finalName = name.trim() || t('photo.defaultName');
    let id: string;
    try {
      const design = store.saveCopy(conversionToDesign(conversion, finalName));
      id = design.id;
      toast(t('photo.created', { name: design.name }), 'success');
    } catch (error) {
      console.error(error);
      toast(t('photo.errorCreate'), 'error');
      return;
    }
    navigate(routes.design(id, 'edit'));
  };

  return (
    <div ref={pageRef} className="page photo-page">
      <header className="page-header">
        <div className="stack photo-title">
          <h1>{t('photo.title')}</h1>
          <p className="muted">{t('photo.intro')}</p>
        </div>
      </header>
      <p className="photo-privacy">
        <Icon name="lock" size={20} />
        {t('photo.privacy')}
      </p>

      {stage.step === 'pick' && (
        <>
          {stage.error && (
            <p className="error" role="alert">
              <Icon name="warning" size={20} />
              {t(ERROR_TEXT[stage.error])}
            </p>
          )}
          <PhotoPicker dragActive={dragActive} onFile={(file) => void loadFile(file)} />
        </>
      )}

      {stage.step === 'loading' && (
        <div className="panel photo-loading" role="status" aria-busy="true">
          <div className="spinner" />
          <p>{t('photo.loading')}</p>
        </div>
      )}

      {stage.step === 'layouts' && (
        <>
          {dragActive && (
            <p className="photo-drop-banner" aria-hidden="true">
              <Icon name="image" />
              {t('photo.dropActive')}
            </p>
          )}
          <PhotoLayouts
            source={stage.source}
            onPick={(view) => setStage({ step: 'tune', source: stage.source, view })}
            onAnotherPhoto={() => setStage({ step: 'pick' })}
          />
        </>
      )}

      {stage.step === 'tune' && (
        <PhotoTuner
          key={stage.view.preset.id}
          source={stage.source}
          view={stage.view}
          name={name}
          onNameChange={setName}
          onBack={() => setStage({ step: 'layouts', source: stage.source })}
          onCreate={create}
        />
      )}
    </div>
  );
}
