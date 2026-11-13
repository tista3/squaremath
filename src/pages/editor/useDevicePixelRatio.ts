// Current window.devicePixelRatio as React state, so canvases redraw crisply when it changes (window
// dragged to a monitor with another DPR, browser zoom) even when no resize event fires.
import { useEffect, useState } from 'react';

const currentDpr = () => (typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1);

export function useDevicePixelRatio(): number {
  const [dpr, setDpr] = useState(currentDpr);
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    let query: MediaQueryList | null = null;
    const onChange = () => {
      setDpr(currentDpr());
      arm();
    };
    // A resolution query only matches one DPR, so it is re-armed for the new value after every change.
    const arm = () => {
      query?.removeEventListener?.('change', onChange);
      query = window.matchMedia(`(resolution: ${currentDpr()}dppx)`);
      query.addEventListener?.('change', onChange);
    };
    arm();
    setDpr(currentDpr());
    return () => query?.removeEventListener?.('change', onChange);
  }, []);
  return dpr;
}
