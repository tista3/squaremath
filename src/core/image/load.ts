// OWNER: image-core agent. Browser-only: decode an image file into pixels.
import { WORKING_SIZE } from './types';
import type { CropBox, RgbaImage } from './types';

/** Accepted file types for the photo picker (input accept attribute). */
export const IMAGE_ACCEPT = 'image/jpeg,image/png,image/webp,image/gif,image/bmp';

type Ctx = OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D;

function makeCanvas(w: number, h: number): { ctx: Ctx } | null {
  if (typeof OffscreenCanvas !== 'undefined') {
    const ctx = new OffscreenCanvas(w, h).getContext('2d', { willReadFrequently: true });
    if (ctx) return { ctx };
  }
  if (typeof document !== 'undefined') {
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (ctx) return { ctx };
  }
  return null;
}

/**
 * Decode a JPG/PNG/WebP/GIF/BMP file (EXIF orientation applied) and downscale so the long side is ≤ maxSide.
 * With `region` (shares 0..1 of the oriented picture) only that part is loaded, from the original pixels: a
 * small figure on a big sheet keeps all its detail.
 * Rejects with Error('unsupported') for non-images / undecodable files.
 */
export async function loadImageFile(file: Blob, maxSide: number = WORKING_SIZE, region?: CropBox): Promise<RgbaImage> {
  if (typeof createImageBitmap !== 'function') throw new Error('unsupported');
  let bitmap: ImageBitmap | null = null;
  const steps: ImageBitmap[] = [];
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
    if (region) {
      const { width: fw, height: fh } = bitmap;
      const x = Math.min(fw - 1, Math.max(0, Math.round(region.x * fw)));
      const y = Math.min(fh - 1, Math.max(0, Math.round(region.y * fh)));
      const part = await createImageBitmap(
        bitmap,
        x,
        y,
        Math.min(fw - x, Math.max(1, Math.round(region.w * fw))),
        Math.min(fh - y, Math.max(1, Math.round(region.h * fh))),
      );
      bitmap.close();
      bitmap = part;
    }
    const sw = bitmap.width;
    const sh = bitmap.height;
    if (!(sw > 0 && sh > 0)) throw new Error('unsupported');
    const side = Math.max(1, Math.floor(maxSide));
    const scale = Math.min(1, side / Math.max(sw, sh));
    const w = Math.max(1, Math.round(sw * scale));
    const h = Math.max(1, Math.round(sh * scale));
    // Big reductions in halving steps: one high-quality draw per step keeps the result close to an area average.
    let source: CanvasImageSource = bitmap;
    let cw = sw;
    let ch = sh;
    while (cw / 2 >= w && ch / 2 >= h && cw > 1 && ch > 1) {
      const nw = Math.max(w, Math.round(cw / 2));
      const nh = Math.max(h, Math.round(ch / 2));
      const step = makeCanvas(nw, nh);
      if (!step) throw new Error('unsupported');
      step.ctx.imageSmoothingEnabled = true;
      step.ctx.imageSmoothingQuality = 'high';
      step.ctx.drawImage(source, 0, 0, nw, nh);
      const next = await createImageBitmap(step.ctx.canvas);
      steps.push(next);
      source = next;
      cw = nw;
      ch = nh;
    }
    const target = makeCanvas(w, h);
    if (!target) throw new Error('unsupported');
    target.ctx.imageSmoothingEnabled = true;
    target.ctx.imageSmoothingQuality = 'high';
    target.ctx.clearRect(0, 0, w, h);
    target.ctx.drawImage(source, 0, 0, w, h);
    const data = target.ctx.getImageData(0, 0, w, h).data;
    return { width: w, height: h, data: new Uint8ClampedArray(data) };
  } catch {
    throw new Error('unsupported');
  } finally {
    bitmap?.close();
    for (const s of steps) s.close();
  }
}
