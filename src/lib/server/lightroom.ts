import { z } from 'zod';
import { AppError, createProject, db, getAsset, getProject, saveProject } from './db';
import { checksum, importPhoto, MAX_FILE_BYTES, replacePhotoBytes, updateAssetMetadata, withImportSlot } from './storage';
import { guardIntegration, readJson } from './http';
import type { Asset } from '../domain';

export const LIGHTROOM = 'lightroom';
const LR_EPOCH_OFFSET = 978307200;
const identifier = z.coerce.string().regex(/^[A-Za-z0-9_-]{1,64}$/);
const collectionName = z.string().trim().min(1).max(100);
export const lightroomMetadataSchema = z.object({
  lrCollectionId: identifier,
  lrCollectionName: collectionName,
  lrPhotoUuid: identifier,
  assetId: z.uuid().nullish(),
  filename: z.string().trim().min(1).max(255),
  rating: z.number().int().min(0).max(5).nullish(),
  label: z.string().max(40).nullish(),
  pick: z.union([z.literal(-1), z.literal(0), z.literal(1)]).nullish(),
  keywords: z.array(z.string().trim().min(1).max(100)).max(100).nullish(),
  dateTimeOriginal: z.number().finite().nullish(),
});
export type LightroomMetadata = z.infer<typeof lightroomMetadataSchema>;
const collectionSchema = z.object({ lrCollectionId: identifier, name: collectionName, action: z.enum(['ensure', 'rename', 'unlink']) });
const unlinkSchema = z.object({ assetIds: z.array(z.uuid()).min(1).max(1000) });
type LinkRow = { lrCollectionId: string; projectId: string; name: string; unlinkedAt: string | null };

export function parseMetadata(value: unknown) {
  if (typeof value !== 'string' || !value || value.length > 12000) throw new AppError('Missing or oversized Lightroom metadata.');
  let decoded: unknown;
  try { decoded = JSON.parse(value); }
  catch { throw new AppError('Lightroom metadata is not valid JSON.'); }
  return lightroomMetadataSchema.parse(decoded);
}
export async function readLightroomUpload(request: Request) {
  if (!(request.headers.get('content-type') || '').startsWith('multipart/form-data')) throw new AppError('Expected a multipart upload from Lightroom.');
  const length = Number(request.headers.get('content-length'));
  if (!length || length > MAX_FILE_BYTES + 1024 * 1024) throw new AppError('Photos must be below 50 MiB.', 413);
  let form: FormData;
  try { form = await request.formData(); }
  catch { throw new AppError('The Lightroom upload could not be read.'); }
  const photo = form.get('photo');
  if (!(photo instanceof Blob) || photo.size > MAX_FILE_BYTES) throw new AppError('The Lightroom upload has no valid photo.');
  return { meta: parseMetadata(form.get('metadata')), bytes: Buffer.from(await photo.arrayBuffer()) };
}

function renameProject(projectId: string, name: string) {
  const project = getProject(projectId);
  if (project.document.title !== name) saveProject(projectId, project.revision, { ...project.document, title: name });
}
export function ensureCollection(lrCollectionId: string, name: string) {
  const row = db().prepare('SELECT * FROM lightroom_collections WHERE lrCollectionId = ?').get(lrCollectionId) as LinkRow | undefined;
  if (row && db().prepare('SELECT 1 FROM projects WHERE id = ?').get(row.projectId)) {
    if (row.name !== name) renameProject(row.projectId, name);
    db().prepare('UPDATE lightroom_collections SET name = ?, unlinkedAt = NULL WHERE lrCollectionId = ?').run(name, lrCollectionId);
    return row.projectId;
  }
  const project = createProject(name);
  db().prepare('INSERT OR REPLACE INTO lightroom_collections (lrCollectionId, projectId, name, unlinkedAt) VALUES (?, ?, ?, NULL)').run(lrCollectionId, project.id, name);
  return project.id;
}
export function updateCollection(input: z.infer<typeof collectionSchema>) {
  if (input.action === 'ensure') return { projectId: ensureCollection(input.lrCollectionId, input.name) };
  const row = db().prepare('SELECT * FROM lightroom_collections WHERE lrCollectionId = ?').get(input.lrCollectionId) as LinkRow | undefined;
  if (!row) return { projectId: null };
  if (input.action === 'rename') {
    renameProject(row.projectId, input.name);
    db().prepare('UPDATE lightroom_collections SET name = ? WHERE lrCollectionId = ?').run(input.name, input.lrCollectionId);
  } else {
    const ids = (db().prepare('SELECT assetId FROM lightroom_photos WHERE lrCollectionId = ?').all(input.lrCollectionId) as { assetId: string }[]).map(r => r.assetId);
    if (ids.length) unlinkPhotos(ids);
    db().prepare('UPDATE lightroom_collections SET unlinkedAt = ? WHERE lrCollectionId = ?').run(new Date().toISOString(), input.lrCollectionId);
  }
  return { projectId: row.projectId };
}

function lightroomFields(meta: LightroomMetadata): Partial<Asset> {
  const captured = meta.dateTimeOriginal == null ? null : new Date((meta.dateTimeOriginal + LR_EPOCH_OFFSET) * 1000);
  return {
    source: 'lightroom', unlinked: false, rating: meta.rating ?? null, label: meta.label || null, pick: meta.pick ?? 0, keywords: meta.keywords ?? [],
    ...(captured && !Number.isNaN(captured.getTime()) ? { capturedAt: captured.toISOString() } : {}),
  };
}
function link(assetId: string, meta: LightroomMetadata) {
  db().prepare('INSERT INTO lightroom_photos (assetId, lrPhotoUuid, lrCollectionId, unlinkedAt) VALUES (?, ?, ?, NULL) ON CONFLICT(assetId) DO UPDATE SET lrPhotoUuid = excluded.lrPhotoUuid, lrCollectionId = excluded.lrCollectionId, unlinkedAt = NULL').run(assetId, meta.lrPhotoUuid, meta.lrCollectionId);
}
function findLinked(projectId: string, meta: LightroomMetadata) {
  const byId = meta.assetId ? db().prepare('SELECT a.id FROM assets a JOIN lightroom_photos l ON l.assetId = a.id WHERE a.id = ? AND a.projectId = ?').get(meta.assetId, projectId) as { id: string } | undefined : undefined;
  const row = byId ?? db().prepare('SELECT assetId AS id FROM lightroom_photos WHERE lrCollectionId = ? AND lrPhotoUuid = ?').get(meta.lrCollectionId, meta.lrPhotoUuid) as { id: string } | undefined;
  return row ? getAsset(row.id) : null;
}

export async function publishPhoto(meta: LightroomMetadata, bytes: Buffer) {
  const projectId = ensureCollection(meta.lrCollectionId, meta.lrCollectionName);
  const fields = lightroomFields(meta);
  const hash = checksum(bytes);
  const existing = findLinked(projectId, meta);
  if (existing) {
    if (existing.hash === hash) {
      updateAssetMetadata({ ...existing, ...fields, capturedAt: fields.capturedAt ?? existing.capturedAt });
      link(existing.id, meta);
      return { assetId: existing.id, projectId, created: false, replaced: false, metadataOnly: true };
    }
    const clash = db().prepare('SELECT id FROM assets WHERE projectId = ? AND hash = ? AND id != ?').get(projectId, hash, existing.id);
    if (clash) throw new AppError('This rendered photo is already in the collection as a separate photo.', 409);
    const replaced = await replacePhotoBytes(existing, bytes, fields);
    link(replaced.id, meta);
    return { assetId: replaced.id, projectId, created: false, replaced: true, metadataOnly: false };
  }
  const { asset, duplicate } = await importPhoto(projectId, meta.filename, bytes, fields);
  if (duplicate) {
    const owner = db().prepare('SELECT lrPhotoUuid, lrCollectionId FROM lightroom_photos WHERE assetId = ?').get(asset.id) as { lrPhotoUuid: string; lrCollectionId: string } | undefined;
    if (owner && owner.lrPhotoUuid !== meta.lrPhotoUuid) throw new AppError('This rendered photo is already linked to another Lightroom photo.', 409);
    updateAssetMetadata({ ...asset, ...fields, capturedAt: fields.capturedAt ?? asset.capturedAt });
  }
  link(asset.id, meta);
  return { assetId: asset.id, projectId, created: !duplicate, replaced: false, metadataOnly: duplicate };
}
export function unlinkPhotos(assetIds: string[]) {
  let count = 0;
  const now = new Date().toISOString();
  for (const id of assetIds) {
    const linked = db().prepare('SELECT assetId FROM lightroom_photos WHERE assetId = ?').get(id);
    if (!linked) continue;
    db().prepare('UPDATE lightroom_photos SET unlinkedAt = ? WHERE assetId = ?').run(now, id);
    updateAssetMetadata({ ...getAsset(id), unlinked: true });
    count++;
  }
  return { unlinked: count };
}

export async function handleLightroom(request: Request, rest: string[]) {
  guardIntegration(request, LIGHTROOM);
  const [resource, action] = rest;
  const method = request.method;
  if (resource === 'ping' && method === 'GET' && rest.length === 1) return { ok: true, app: 'autopost', version: 1 };
  if (resource === 'collections' && method === 'POST' && rest.length === 1) return updateCollection(collectionSchema.parse(await readJson(request)));
  if (resource === 'photos' && method === 'POST' && rest.length === 1) {
    return await withImportSlot(async () => {
      const { meta, bytes } = await readLightroomUpload(request);
      return publishPhoto(meta, bytes);
    });
  }
  if (resource === 'photos' && action === 'unlink' && method === 'POST' && rest.length === 2) return unlinkPhotos(unlinkSchema.parse(await readJson(request)).assetIds);
  throw new AppError('Not found.', 404);
}
