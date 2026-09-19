import type { Frame } from './domain';

export const CANVAS = { width: 1080, height: 1350 };
export type Rect = { x: number; y: number; width: number; height: number };

export function layout(width: number, height: number, frame: Frame): { source: Rect; target: Rect } {
  if (!(width > 0 && height > 0)) throw new Error('Invalid image dimensions.');
  const cw = CANVAS.width;
  const ch = CANVAS.height;
  const margin = frame.mode === 'fit' ? Math.round(cw * frame.margin) : 0;
  const aw = cw - margin * 2;
  const ah = ch - margin * 2;
  const scale = frame.mode === 'fit' ? Math.min(aw / width, ah / height) : Math.max(cw / width, ch / height) * frame.zoom;
  const iw = width * scale;
  const ih = height * scale;
  const left = margin + (aw - iw) * frame.x;
  const top = margin + (ah - ih) * frame.y;
  const tx = Math.max(margin, Math.round(left));
  const ty = Math.max(margin, Math.round(top));
  const tw = Math.max(1, Math.min(cw - margin, Math.round(left + iw)) - tx);
  const th = Math.max(1, Math.min(ch - margin, Math.round(top + ih)) - ty);
  const sx = Math.max(0, Math.round((tx - left) / scale));
  const sy = Math.max(0, Math.round((ty - top) / scale));
  return {
    source: { x: sx, y: sy, width: Math.max(1, Math.min(width - sx, Math.round(tw / scale))), height: Math.max(1, Math.min(height - sy, Math.round(th / scale))) },
    target: { x: tx, y: ty, width: tw, height: th },
  };
}
