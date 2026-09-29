import path from 'node:path';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import sharp, { type Metadata } from 'sharp';
import exifr from 'exifr';
import { AppError, dataRoot, db, getAsset, getProject } from './db';
import type { Asset } from '../domain';

export const MAX_FILE_BYTES = 50 * 1024 * 1024;
export const MAX_PIXELS = 100_000_000;
export function assetPath(id: string, kind: 'original' | 'thumb' | 'preview' | 'analysis', format: 'jpeg' | 'png' = 'jpeg') {
  if (!/^[0-9a-f-]{36}$/.test(id)) throw new AppError('Invalid photo ID.');
  const extension = kind !== 'analysis' && format === 'png' ? 'png' : 'jpg';
  return path.join(dataRoot, 'assets', id, kind === 'original' ? 'original' : `${kind}.${extension}`);
}
export const checksum = (data: Buffer) => createHash('sha256').update(data).digest('hex');
export async function readUpload(request: Request) {
  if (!request.body) throw new AppError('No photo supplied.');
  if (Number(request.headers.get('content-length')) > MAX_FILE_BYTES) throw new AppError('Photos must be below 50 MiB.', 413);
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.length;
    if (length > MAX_FILE_BYTES) { await reader.cancel(); throw new AppError('Photos must be below 50 MiB.', 413); }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}
async function inspect(bytes: Buffer) {
  if (!bytes.length || bytes.length > MAX_FILE_BYTES) throw new AppError('Invalid file size. Maximum is 50 MiB.', 413);
  let metadata: Metadata;
  try { metadata = await sharp(bytes, { limitInputPixels: MAX_PIXELS, animated: false }).metadata(); }
  catch { throw new AppError('This file is damaged, unsupported, or exceeds 100 megapixels.'); }
  if (!['jpeg', 'png'].includes(metadata.format || '') || !metadata.width || !metadata.height || (metadata.pages || 1) > 1) throw new AppError('Import a single-frame JPEG or PNG.');
  const rotated = (metadata.orientation || 1) > 4;
  let capturedAt: string | null = null;
  try {
    const exif = await exifr.parse(bytes, ['DateTimeOriginal']);
    if (exif?.DateTimeOriginal instanceof Date && !Number.isNaN(exif.DateTimeOriginal.getTime())) capturedAt = exif.DateTimeOriginal.toISOString();
  } catch { capturedAt = null; }
  return { width: rotated ? metadata.height : metadata.width, height: rotated ? metadata.width : metadata.height, capturedAt, derivativeFormat: metadata.hasAlpha ? 'png' as const : 'jpeg' as const };
}
async function writeVerifiedCopy(target: string, bytes: Buffer, hash: string) {
  await writeFile(target, bytes, { flag: 'wx', mode: 0o600 });
  if (checksum(await readFile(target)) !== hash) throw new AppError('Copy verification failed. Please retry.', 500);
}
async function writeDerivatives(id: string, bytes: Buffer, derivativeFormat: 'jpeg' | 'png', suffix = '') {
  const written: [string, string][] = [];
  for (const [kind, size] of [['thumb', 480], ['preview', 1800], ['analysis', 768]] as const) {
    const pipeline = sharp(bytes, { limitInputPixels: MAX_PIXELS }).autoOrient().resize(size, size, { fit: 'inside', withoutEnlargement: true }).withIccProfile('srgb');
    const target = kind !== 'analysis' && derivativeFormat === 'png' ? assetPath(id, kind, derivativeFormat) : assetPath(id, kind);
    if (kind !== 'analysis' && derivativeFormat === 'png') await pipeline.png().toFile(target + suffix);
    else await pipeline.flatten({ background: '#ffffff' }).jpeg({ quality: kind === 'preview' ? 90 : 80 }).toFile(target + suffix);
    written.push([target + suffix, target]);
  }
  return written;
}
export async function importPhoto(projectId: string, filename: string, bytes: Buffer, extra: Partial<Asset> = {}) {
  getProject(projectId);
  const hash = checksum(bytes);
  const existing = db().prepare('SELECT id FROM assets WHERE projectId = ? AND hash = ?').get(projectId, hash) as { id: string } | undefined;
  if (existing) return { asset: getAsset(existing.id), duplicate: true };
  const info = await inspect(bytes);
  const id = randomUUID();
  await mkdir(path.dirname(assetPath(id, 'original')), { recursive: true, mode: 0o700 });
  await writeVerifiedCopy(assetPath(id, 'original'), bytes, hash);
  await writeDerivatives(id, bytes, info.derivativeFormat);
  const asset: Asset = { ...extra, id, projectId, hash, filename: path.basename(filename.replaceAll('\\', '/')).slice(0, 200) || 'Untitled photo', width: info.width, height: info.height, bytes: bytes.length, capturedAt: extra.capturedAt ?? info.capturedAt, createdAt: new Date().toISOString(), derivativeFormat: info.derivativeFormat };
  db().prepare('INSERT INTO assets (id, projectId, hash, metadata) VALUES (?, ?, ?, ?)').run(id, projectId, hash, JSON.stringify(asset));
  return { asset, duplicate: false };
}
export function updateAssetMetadata(asset: Asset) {
  db().prepare('UPDATE assets SET metadata = ? WHERE id = ? AND hash = ?').run(JSON.stringify(asset), asset.id, asset.hash);
  return asset;
}
export async function replacePhotoBytes(asset: Asset, bytes: Buffer, changes: Partial<Asset> = {}) {
  const hash = checksum(bytes);
  const info = await inspect(bytes);
  const suffix = `.${randomUUID()}.tmp`;
  const temporary: [string, string][] = [[assetPath(asset.id, 'original') + suffix, assetPath(asset.id, 'original')]];
  try {
    await writeVerifiedCopy(temporary[0][0], bytes, hash);
    temporary.push(...await writeDerivatives(asset.id, bytes, info.derivativeFormat, suffix));
  } catch (error) {
    await Promise.all(temporary.map(([from]) => rm(from, { force: true })));
    throw error;
  }
  for (const [from, to] of temporary) await rename(from, to);
  const next: Asset = { ...asset, ...changes, hash, width: info.width, height: info.height, bytes: bytes.length, capturedAt: changes.capturedAt ?? info.capturedAt ?? asset.capturedAt, derivativeFormat: info.derivativeFormat };
  db().transaction(() => {
    db().prepare('UPDATE assets SET hash = ?, metadata = ? WHERE id = ?').run(hash, JSON.stringify(next), asset.id);
    db().prepare('DELETE FROM analyses WHERE assetId = ?').run(asset.id);
  })();
  return next;
}

const importState = globalThis as typeof globalThis & { autopostImportBusy?: boolean };
export async function withImportSlot<T>(work: () => Promise<T>): Promise<T> {
  if (importState.autopostImportBusy) throw new AppError('Another photo is being processed. Retry in a moment.', 429);
  importState.autopostImportBusy = true;
  try { return await work(); } finally { importState.autopostImportBusy = false; }
}
