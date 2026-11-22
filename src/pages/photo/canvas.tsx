// OWNER: photo-ui agent. Canvas views of the photo page: the analysed photo and the live pixel preview.
import { useEffect, useRef } from 'react';
import type { Conversion, RgbaImage } from '../../core/image/types';

/** Longest side of the preview's backing store in px: crisp when shown up to ~960 device px. */
const PREVIEW_BACKING = 960;

/** Cell size in backing px for a conversion drawn on the preview canvas. */
export function previewCellPx(width: number, height: number): number {
  return Math.max(1, Math.floor(PREVIEW_BACKING / Math.max(1, width, height)));
}

/** Draws the grid of a conversion: one rect per run of equal cells, optional thin grid lines. */
export function drawConversion(ctx: CanvasRenderingContext2D, conversion: Conversion, cellPx: number, gridLines: boolean): void {
  const { width: cols, height: rows, palette, cells } = conversion;
  ctx.clearRect(0, 0, cols * cellPx, rows * cellPx);
  for (let y = 0; y < rows; y++) {
    let x = 0;
    while (x < cols) {
      const index = cells[y * cols + x];
      let end = x + 1;
      while (end < cols && cells[y * cols + end] === index) end++;
      ctx.fillStyle = palette[index]?.hex ?? '#ffffff';
      ctx.fillRect(x * cellPx, y * cellPx, (end - x) * cellPx, cellPx);
      x = end;
    }
  }
  if (!gridLines || cellPx < 4) return;
  const lineWidth = Math.max(1, Math.round(cellPx / 24));
  const offset = lineWidth % 2 ? 0.5 : 0;
  ctx.beginPath();
  for (let x = 1; x < cols; x++) {
    ctx.moveTo(x * cellPx + offset, 0);
    ctx.lineTo(x * cellPx + offset, rows * cellPx);
  }
  for (let y = 1; y < rows; y++) {
    ctx.moveTo(0, y * cellPx + offset);
    ctx.lineTo(cols * cellPx, y * cellPx + offset);
  }
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.28)';
  ctx.lineWidth = lineWidth;
  ctx.stroke();
}

/** Live preview of a conversion (redrawn when the conversion or grid lines change). */
export function ConversionCanvas({ conversion, gridLines, label }: { conversion: Conversion; gridLines: boolean; label: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const cellPx = previewCellPx(conversion.width, conversion.height);
  const w = conversion.width * cellPx;
  const h = conversion.height * cellPx;

  useEffect(() => {
    const ctx = ref.current?.getContext('2d');
    if (ctx) drawConversion(ctx, conversion, cellPx, gridLines);
  }, [conversion, cellPx, gridLines]);

  return <canvas ref={ref} className="photo-preview-canvas" width={w} height={h} role="img" aria-label={label} />;
}

/** An image (the analysed photo, a sheet, a figure), drawn pixel for pixel. */
export function ImageCanvas({
  image,
  label,
  className = 'photo-original-canvas',
}: {
  image: RgbaImage;
  label: string;
  className?: string;
}) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const ctx = ref.current?.getContext('2d');
    if (!ctx || image.width === 0 || image.height === 0) return;
    const data = ctx.createImageData(image.width, image.height);
    data.data.set(image.data.subarray(0, data.data.length));
    ctx.putImageData(data, 0, 0);
  }, [image]);

  return <canvas ref={ref} className={className} width={image.width} height={image.height} role="img" aria-label={label} />;
}
