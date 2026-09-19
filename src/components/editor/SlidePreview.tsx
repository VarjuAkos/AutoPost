'use client';

import { assetUrl, type Asset, type Frame } from '@/lib/domain';
import { CANVAS, layout } from '@/lib/layout';

export function SlidePreview({ asset, frame, thumbnail = false }: { asset: Asset; frame: Frame; thumbnail?: boolean }) {
  const { source, target } = layout(asset.width, asset.height, frame);
  return <svg viewBox={`0 0 ${CANVAS.width} ${CANVAS.height}`} className="slide-preview" role="img" aria-label={`Framed preview of ${asset.filename}`}>
    <rect width={CANVAS.width} height={CANVAS.height} fill={frame.background} />
    <svg x={target.x} y={target.y} width={target.width} height={target.height} viewBox={`${source.x} ${source.y} ${source.width} ${source.height}`} preserveAspectRatio="none" overflow="hidden">
      <image href={assetUrl(asset.id, thumbnail ? 'thumb' : 'preview')} x={0} y={0} width={asset.width} height={asset.height} preserveAspectRatio="none" />
    </svg>
  </svg>;
}
