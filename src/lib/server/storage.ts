import path from 'node:path';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
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
export async function importPhoto(projectId: string, filename: string, bytes: Buffer) {
  getProject(projectId);
  if (!bytes.length || bytes.length > MAX_FILE_BYTES) throw new AppError('Invalid file size. Maximum is 50 MiB.', 413);
  const hash = checksum(bytes);
  const existing = db().prepare('SELECT id FROM assets WHERE projectId = ? AND hash = ?').get(projectId, hash) as { id: string } | undefined;
  if (existing) return { asset: getAsset(existing.id), duplicate: true };
  let metadata: Metadata;
  try { metadata = await sharp(bytes, { limitInputPixels: MAX_PIXELS, animated: false }).metadata(); }
  catch { throw new AppError('This file is damaged, unsupported, or exceeds 100 megapixels.'); }
  if (!['jpeg', 'png'].includes(metadata.format || '') || !metadata.width || !metadata.height || (metadata.pages || 1) > 1) throw new AppError('Import a single-frame JPEG or PNG.');
  const rotated = (metadata.orientation || 1) > 4;
  const width = rotated ? metadata.height : metadata.width;
  const height = rotated ? metadata.width : metadata.height;
  let capturedAt: string | null = null;
  try {
    const exif = await exifr.parse(bytes, ['DateTimeOriginal']);
    if (exif?.DateTimeOriginal instanceof Date && !Number.isNaN(exif.DateTimeOriginal.getTime())) capturedAt = exif.DateTimeOriginal.toISOString();
  } catch { capturedAt = null; }
  const id = randomUUID();
  await mkdir(path.dirname(assetPath(id, 'original')), { recursive: true, mode: 0o700 });
  await writeFile(assetPath(id, 'original'), bytes, { flag: 'wx', mode: 0o600 });
  if (checksum(await readFile(assetPath(id, 'original'))) !== hash) throw new AppError('Copy verification failed. Please retry.', 500);
  const derivativeFormat = metadata.hasAlpha ? 'png' : 'jpeg';
  for (const [kind, size] of [['thumb', 480], ['preview', 1800], ['analysis', 768]] as const) {
    const pipeline = sharp(bytes, { limitInputPixels: MAX_PIXELS }).autoOrient().resize(size, size, { fit: 'inside', withoutEnlargement: true }).withIccProfile('srgb');
    if (kind !== 'analysis' && derivativeFormat === 'png') await pipeline.png().toFile(assetPath(id, kind, derivativeFormat));
    else await pipeline.flatten({ background: '#ffffff' }).jpeg({ quality: kind === 'preview' ? 90 : 80 }).toFile(assetPath(id, kind));
  }
  const asset: Asset = { id, projectId, hash, filename: path.basename(filename.replaceAll('\\', '/')).slice(0, 200) || 'Untitled photo', width, height, bytes: bytes.length, capturedAt, createdAt: new Date().toISOString(), derivativeFormat };
  db().prepare('INSERT INTO assets (id, projectId, hash, metadata) VALUES (?, ?, ?, ?)').run(id, projectId, hash, JSON.stringify(asset));
  return { asset, duplicate: false };
}

const importState = globalThis as typeof globalThis & { autopostImportBusy?: boolean };
export async function withImportSlot<T>(work: () => Promise<T>): Promise<T> {
  if (importState.autopostImportBusy) throw new AppError('Another photo is being processed. Retry in a moment.', 429);
  importState.autopostImportBusy = true;
  try { return await work(); } finally { importState.autopostImportBusy = false; }
}
