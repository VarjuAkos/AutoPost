import sharp from 'sharp';
import { layout, CANVAS } from '../layout';
import type { Asset, Frame } from '../domain';
import { assetPath, MAX_PIXELS } from './storage';

export async function renderSlide(asset: Asset, frame: Frame): Promise<Buffer> {
  const { source, target } = layout(asset.width, asset.height, frame);
  const image = await sharp(assetPath(asset.id, 'original'), { limitInputPixels: MAX_PIXELS })
    .autoOrient().extract({ left: source.x, top: source.y, width: source.width, height: source.height })
    .resize(target.width, target.height, { fit: 'fill' }).flatten({ background: frame.background })
    .withIccProfile('srgb').png().toBuffer();
  return sharp({ create: { ...CANVAS, channels: 3, background: frame.background } })
    .composite([{ input: image, left: target.x, top: target.y }])
    .withIccProfile('srgb').jpeg({ quality: 95, chromaSubsampling: '4:4:4' }).toBuffer();
}
