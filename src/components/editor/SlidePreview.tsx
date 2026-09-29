'use client';

import { assetUrl, RATIOS, type Asset, type Frame, type Ratio } from '@/lib/domain';
import { layout } from '@/lib/layout';

export function SlidePreview({ asset, frame, ratio, thumbnail = false }: { asset: Asset; frame: Frame; ratio: Ratio; thumbnail?: boolean }) {
  const { source, target } = layout(asset.width, asset.height, frame, ratio);
  const canvas = RATIOS[ratio];
  return <svg viewBox={`0 0 ${canvas.width} ${canvas.height}`} className="slide-preview" role="img" aria-label={`Framed preview of ${asset.filename}`}>
    <rect width={canvas.width} height={canvas.height} fill={frame.background} />
    <svg x={target.x} y={target.y} width={target.width} height={target.height} viewBox={`${source.x} ${source.y} ${source.width} ${source.height}`} preserveAspectRatio="none" overflow="hidden">
      <image href={assetUrl(asset.id, thumbnail ? 'thumb' : 'preview')} x={0} y={0} width={asset.width} height={asset.height} preserveAspectRatio="none" />
    </svg>
  </svg>;
}
