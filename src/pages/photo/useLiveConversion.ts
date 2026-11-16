// OWNER: photo-ui agent. Recomputes the conversion at most once per animation frame while sliders move.
import { useCallback, useEffect, useRef, useState } from 'react';
import { convertImage } from '../../core/image/pipeline';
import type { Conversion, ConvertParams, ImageAnalysis } from '../../core/image/types';

interface LiveResult {
  /** The params `conversion` was computed for. */
  params: ConvertParams;
  /** Latest successful conversion (kept on screen when a later one fails). */
  conversion: Conversion;
  /** The conversion for `params` threw. */
  failed: boolean;
}

function nextFrame(run: () => void): () => void {
  if (typeof requestAnimationFrame === 'function') {
    const id = requestAnimationFrame(run);
    return () => cancelAnimationFrame(id);
  }
  const id = setTimeout(run, 16);
  return () => clearTimeout(id);
}

/**
 * The conversion for `params`, computed in the next animation frame after a change (a burst of slider
 * events in one frame costs one conversion). `initial` is the already known result for `initialParams`.
 * `latest()` returns the conversion for the current params right away (computing it if a frame is pending),
 * or null when it fails.
 */
export function useLiveConversion(analysis: ImageAnalysis, params: ConvertParams, initial: { params: ConvertParams; conversion: Conversion }) {
  const [result, setResult] = useState<LiveResult>(() => ({ ...initial, failed: false }));
  const doneFor = useRef(initial.params);

  useEffect(() => {
    if (doneFor.current === params) return;
    return nextFrame(() => {
      doneFor.current = params;
      try {
        const conversion = convertImage(analysis, params);
        setResult({ params, conversion, failed: false });
      } catch (error) {
        console.error(error);
        setResult((prev) => ({ params, conversion: prev.conversion, failed: true }));
      }
    });
  }, [analysis, params]);

  const pending = result.params !== params;
  const latest = useCallback((): Conversion | null => {
    if (!pending) return result.failed ? null : result.conversion;
    try {
      return convertImage(analysis, params);
    } catch (error) {
      console.error(error);
      return null;
    }
  }, [analysis, params, pending, result]);

  return { conversion: result.conversion, failed: result.failed && !pending, pending, latest };
}
