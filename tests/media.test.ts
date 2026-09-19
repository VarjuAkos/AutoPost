import { describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { readFile } from 'node:fs/promises';
import { createProject, getProject, saveProject } from '../src/lib/server/db';
import { assetPath, checksum, importPhoto } from '../src/lib/server/storage';
import { renderSlide } from '../src/lib/server/images';
import { defaultFrame } from '../src/lib/domain';

describe('safe media pipeline', () => {
  it('copies exact source bytes, deduplicates, and exports a framed JPEG', async () => {
    const project = createProject('Synthetic media test');
    const original = await sharp({ create: { width: 600, height: 400, channels: 3, background: '#ed5733' } }).jpeg().toBuffer();
    const { asset } = await importPhoto(project.id, '../../original.jpg', original);
    expect(asset.filename).toBe('original.jpg');
    expect(await readFile(assetPath(asset.id, 'original'))).toEqual(original);
    expect((await importPhoto(project.id, 'copy.jpg', original)).duplicate).toBe(true);
    const output = await renderSlide(asset, { ...defaultFrame, margin: 0 });
    const metadata = await sharp(output).metadata();
    expect(metadata.width).toBe(1080);
    expect(metadata.height).toBe(1350);
    expect(metadata.exif).toBeUndefined();
    expect(checksum(await readFile(assetPath(asset.id, 'original')))).toBe(asset.hash);
    const { data, info } = await sharp(output).raw().toBuffer({ resolveWithObject: true });
    expect([...data.subarray(0, 3)]).toEqual([255, 255, 255]);
    const center = (675 * info.width + 540) * info.channels;
    expect(data[center]).toBeGreaterThan(220);
    expect(data[center + 1]).toBeLessThan(100);
  });
  it('normalizes EXIF rotation before framing and removes private metadata', async () => {
    const project = createProject('Orientation test');
    const original = await sharp({ create: { width: 600, height: 400, channels: 3, background: '#326b8c' } }).withMetadata({ orientation: 6 }).jpeg().toBuffer();
    const { asset } = await importPhoto(project.id, 'rotated.jpg', original);
    expect([asset.width, asset.height]).toEqual([400, 600]);
    const preview = await sharp(assetPath(asset.id, 'preview')).metadata();
    expect([preview.width, preview.height, preview.orientation]).toEqual([400, 600, undefined]);
    const output = await renderSlide(asset, { ...defaultFrame, mode: 'fill', zoom: 1.5 });
    expect((await sharp(output).metadata()).exif).toBeUndefined();
    expect(checksum(await readFile(assetPath(asset.id, 'original')))).toBe(checksum(original));
  });
  it('keeps PNG transparency so preview and black-background export agree', async () => {
    const project = createProject('Transparency test');
    const original = await sharp({ create: { width: 600, height: 400, channels: 4, background: { r: 255, g: 0, b: 0, alpha: 0 } } }).png().toBuffer();
    const { asset } = await importPhoto(project.id, 'transparent.png', original);
    const preview = await sharp(assetPath(asset.id, 'preview', asset.derivativeFormat)).metadata();
    expect(preview.hasAlpha).toBe(true);
    const output = await renderSlide(asset, { ...defaultFrame, mode: 'fill', background: '#101010' });
    const { data } = await sharp(output).raw().toBuffer({ resolveWithObject: true });
    expect([...data.subarray(0, 3)]).toEqual([16, 16, 16]);
  });
  it('rejects corrupt input and stale saves', async () => {
    const project = createProject('Revision test');
    await expect(importPhoto(project.id, 'broken.jpg', Buffer.from('not an image'))).rejects.toThrow();
    expect(saveProject(project.id, 0, project.document)).toBe(1);
    expect(() => saveProject(project.id, 0, project.document)).toThrow('another tab');
    expect(getProject(project.id).revision).toBe(1);
  });
});
