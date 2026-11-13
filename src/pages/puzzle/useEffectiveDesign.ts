// The design a puzzle/solve page works with. Own designs persist through onChange; read-only shared
// designs keep settings changes in local state. Settings can also arrive via router location state
// (see carriedState): shared pages start from them, own pages apply them once (after "save a copy").
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import type { Design } from '../../core/types';
import type { DesignPageProps } from '../types';
import { readCarriedSettings, type SheetSettings } from './settings';

export interface EffectiveDesign {
  design: Design;
  update: (updater: (d: Design) => Design) => void;
  readOnly: boolean;
}

function pickSettings(d: Design): SheetSettings {
  return { puzzle: d.puzzle, print: d.print };
}

export function useEffectiveDesign({ design, onChange }: Pick<DesignPageProps, 'design' | 'onChange'>): EffectiveDesign {
  const location = useLocation();
  const navigate = useNavigate();
  const [local, setLocal] = useState(() => ({
    forId: design.id,
    settings: readCarriedSettings(location.state, design) ?? pickSettings(design),
  }));
  if (local.forId !== design.id) setLocal({ forId: design.id, settings: pickSettings(design) });

  useEffect(() => {
    const carried = onChange ? readCarriedSettings(location.state, design) : null;
    if (!carried) return;
    onChange!((d) => ({ ...d, ...carried }));
    navigate(location.pathname, { replace: true, state: null });
    // Only a new location state should trigger this, not design edits.
  }, [location.state]);

  const shared = useMemo(() => ({ ...design, ...local.settings }), [design, local.settings]);
  const updateLocal = useCallback(
    (updater: (d: Design) => Design) =>
      setLocal((prev) => ({ forId: prev.forId, settings: pickSettings(updater({ ...design, ...prev.settings })) })),
    [design],
  );

  return onChange
    ? { design, update: onChange, readOnly: false }
    : { design: shared, update: updateLocal, readOnly: true };
}
