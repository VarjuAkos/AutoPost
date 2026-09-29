import { describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { readFile } from 'node:fs/promises';
import { db, getAsset, getProject, saveProject } from '../src/lib/server/db';
import { assetPath, checksum } from '../src/lib/server/storage';
import { guard, guardIntegration } from '../src/lib/server/http';
import { createIntegrationToken, revokeIntegrationToken, tokenStatus, verifyIntegrationToken } from '../src/lib/server/tokens';
import { handleLightroom, LIGHTROOM, parseMetadata, publishPhoto, unlinkPhotos, updateCollection, type LightroomMetadata } from '../src/lib/server/lightroom';
import { newPost } from '../src/lib/domain';

const image = (color: string) => sharp({ create: { width: 600, height: 400, channels: 3, background: color } }).jpeg().toBuffer();
function meta(overrides: Partial<LightroomMetadata> = {}): LightroomMetadata {
  return { lrCollectionId: `c${crypto.randomUUID().slice(0, 8)}`, lrCollectionName: 'Sziget from Lightroom', lrPhotoUuid: crypto.randomUUID(), filename: 'DSC_0001.jpg', rating: 3, label: 'Red', pick: 1, keywords: ['crowd'], dateTimeOriginal: 800000000, ...overrides };
}
function lrRequest(path: string, init: { token?: string; origin?: string; host?: string; method?: string; body?: BodyInit; headers?: Record<string, string> } = {}) {
  const headers = new Headers({ host: init.host ?? '127.0.0.1:3000', ...init.headers });
  if (init.token) headers.set('authorization', `Bearer ${init.token}`);
  if (init.origin) headers.set('origin', init.origin);
  return new Request(`http://localhost:3000/api/integrations/lightroom/${path}`, { method: init.method ?? 'GET', headers, body: init.body });
}

describe('Lightroom pairing token', () => {
  it('stores only a hash, verifies in constant time, and can be revoked', () => {
    const token = createIntegrationToken(LIGHTROOM);
    const row = db().prepare('SELECT hash FROM integration_tokens WHERE kind = ?').get(LIGHTROOM) as { hash: string };
    expect(row.hash).not.toContain(token);
    expect(JSON.stringify(tokenStatus(LIGHTROOM))).not.toContain(token);
    expect(verifyIntegrationToken(LIGHTROOM, token)).toBe(true);
    expect(verifyIntegrationToken(LIGHTROOM, `${token}x`)).toBe(false);
    expect(tokenStatus(LIGHTROOM).lastUsedAt).not.toBeNull();
    const next = createIntegrationToken(LIGHTROOM);
    expect(verifyIntegrationToken(LIGHTROOM, token)).toBe(false);
    revokeIntegrationToken(LIGHTROOM);
    expect(verifyIntegrationToken(LIGHTROOM, next)).toBe(false);
    expect(tokenStatus(LIGHTROOM).paired).toBe(false);
  });
});

describe('Lightroom integration guard', () => {
  it('accepts only a valid token from a local host without a browser origin', () => {
    const token = createIntegrationToken(LIGHTROOM);
    expect(() => guardIntegration(lrRequest('ping', { token }), LIGHTROOM)).not.toThrow();
    expect(() => guardIntegration(lrRequest('ping'), LIGHTROOM)).toThrow('not paired');
    expect(() => guardIntegration(lrRequest('ping', { token: 'wrong-token-wrong-token-wrong' }), LIGHTROOM)).toThrow('not paired');
    expect(() => guardIntegration(lrRequest('ping', { token, origin: 'http://127.0.0.1:3000' }), LIGHTROOM)).toThrow('browser');
    expect(() => guardIntegration(lrRequest('ping', { token, host: 'example.com:3000' }), LIGHTROOM)).toThrow('localhost');
    expect(() => guard(lrRequest('ping', { token, method: 'POST' }))).toThrow('same-origin');
  });
  it('routes ping and rejects unknown paths', async () => {
    const token = createIntegrationToken(LIGHTROOM);
    expect(await handleLightroom(lrRequest('ping', { token }), ['ping'])).toMatchObject({ ok: true, app: 'autopost' });
    await expect(handleLightroom(lrRequest('nope', { token }), ['nope'])).rejects.toThrow('Not found');
  });
});

describe('Lightroom metadata validation', () => {
  it('rejects malformed, oversized, and out-of-range metadata', () => {
    expect(parseMetadata(JSON.stringify(meta())).rating).toBe(3);
    expect(parseMetadata(JSON.stringify({ ...meta(), rating: null, label: null, keywords: [], lrCollectionId: 42 })).lrCollectionId).toBe('42');
    expect(() => parseMetadata(null)).toThrow();
    expect(() => parseMetadata('{not json')).toThrow();
    expect(() => parseMetadata('x'.repeat(13000))).toThrow('oversized');
    expect(() => parseMetadata(JSON.stringify(meta({ rating: 6 })))).toThrow();
    expect(() => parseMetadata(JSON.stringify(meta({ lrPhotoUuid: '../../etc' })))).toThrow();
    expect(() => parseMetadata(JSON.stringify({ ...meta(), keywords: Array(101).fill('k') }))).toThrow();
  });
});

describe('Lightroom publishing', () => {
  it('creates a linked collection, updates metadata only for identical renders, and replaces edits in place', async () => {
    const first = meta();
    const original = await image('#c25b3a');
    const created = await publishPhoto(first, original);
    expect(created).toMatchObject({ created: true, replaced: false });
    const project = getProject(created.projectId);
    expect(project.document.title).toBe('Sziget from Lightroom');
    const asset = getAsset(created.assetId);
    expect(asset).toMatchObject({ source: 'lightroom', rating: 3, label: 'Red', pick: 1, keywords: ['crowd'], unlinked: false });
    expect(asset.capturedAt).toBe(new Date((800000000 + 978307200) * 1000).toISOString());
    expect(await publishPhoto({ ...first, assetId: created.assetId }, original)).toMatchObject({ assetId: created.assetId, metadataOnly: true });

    db().prepare('INSERT OR REPLACE INTO analyses (assetId, version, content) VALUES (?, ?, ?)').run(created.assetId, 'editorial-v1', '{}');
    const again = await publishPhoto({ ...first, assetId: created.assetId, rating: 5 }, original);
    expect(again.metadataOnly).toBe(true);
    expect(getAsset(created.assetId).rating).toBe(5);
    expect(db().prepare('SELECT COUNT(*) AS n FROM analyses WHERE assetId = ?').get(created.assetId)).toEqual({ n: 1 });

    const post = newPost([created.assetId], 0, 'Uses the photo');
    saveProject(project.id, project.revision, { ...project.document, posts: [post] });
    const edited = await sharp({ create: { width: 400, height: 600, channels: 3, background: '#2d5a7b' } }).jpeg().toBuffer();
    const replaced = await publishPhoto({ ...first, assetId: created.assetId, rating: 4 }, edited);
    expect(replaced).toMatchObject({ assetId: created.assetId, replaced: true });
    const updated = getAsset(created.assetId);
    expect(updated).toMatchObject({ hash: checksum(edited), width: 400, height: 600, rating: 4, createdAt: asset.createdAt });
    expect(await readFile(assetPath(created.assetId, 'original'))).toEqual(edited);
    expect((await sharp(assetPath(created.assetId, 'preview')).metadata()).height).toBe(600);
    expect(db().prepare('SELECT COUNT(*) AS n FROM analyses WHERE assetId = ?').get(created.assetId)).toEqual({ n: 0 });
    expect(getProject(project.id).document.posts[0].slides[0].assetId).toBe(created.assetId);

    const sameCollection = await publishPhoto({ ...first, lrPhotoUuid: crypto.randomUUID(), filename: 'DSC_0002.jpg' }, await image('#e8c547'));
    expect(sameCollection.projectId).toBe(project.id);
    expect(getProject(project.id).assets).toHaveLength(2);
  });
  it('refuses to merge a replacement into a different existing photo', async () => {
    const base = meta();
    const a = await publishPhoto(base, await image('#111111'));
    const bytesB = await image('#eeeeee');
    await publishPhoto({ ...base, lrPhotoUuid: crypto.randomUUID() }, bytesB);
    await expect(publishPhoto({ ...base, assetId: a.assetId }, bytesB)).rejects.toThrow('separate photo');
    await expect(publishPhoto({ ...base, lrPhotoUuid: crypto.randomUUID() }, bytesB)).rejects.toThrow('another Lightroom photo');
  });
  it('unlinks photos and collections without deleting files or posts, and relinks on republish', async () => {
    const base = meta();
    const bytes = await image('#5e7d4a');
    const { assetId, projectId } = await publishPhoto(base, bytes);
    const project = getProject(projectId);
    saveProject(projectId, project.revision, { ...project.document, posts: [newPost([assetId], 0)] });
    expect(unlinkPhotos([assetId, crypto.randomUUID()])).toEqual({ unlinked: 1 });
    expect(getAsset(assetId).unlinked).toBe(true);
    expect(await readFile(assetPath(assetId, 'original'))).toEqual(bytes);
    expect(getProject(projectId).document.posts[0].slides).toHaveLength(1);
    await publishPhoto({ ...base, assetId }, bytes);
    expect(getAsset(assetId).unlinked).toBe(false);
    expect(updateCollection({ lrCollectionId: base.lrCollectionId, name: 'Renamed in Lightroom', action: 'rename' })).toEqual({ projectId });
    expect(getProject(projectId).document.title).toBe('Renamed in Lightroom');
    updateCollection({ lrCollectionId: base.lrCollectionId, name: 'Renamed in Lightroom', action: 'unlink' });
    expect(getAsset(assetId).unlinked).toBe(true);
    expect(getProject(projectId).assets).toHaveLength(1);
    expect(updateCollection({ lrCollectionId: base.lrCollectionId, name: 'Renamed in Lightroom', action: 'ensure' })).toEqual({ projectId });
    expect(updateCollection({ lrCollectionId: 'unknown', name: 'x', action: 'unlink' })).toEqual({ projectId: null });
  });
  it('accepts a multipart upload through the authenticated route and rejects other bodies', async () => {
    const token = createIntegrationToken(LIGHTROOM);
    const bytes = await image('#8a3fa0');
    const form = new FormData();
    form.set('metadata', JSON.stringify(meta({ rating: 2 })));
    form.set('photo', new Blob([new Uint8Array(bytes)], { type: 'image/jpeg' }), 'DSC_0003.jpg');
    const encoded = new Request('http://x/', { method: 'POST', body: form });
    const body = new Uint8Array(await encoded.arrayBuffer());
    const headers = { 'content-type': encoded.headers.get('content-type')!, 'content-length': String(body.length) };
    const result = await handleLightroom(lrRequest('photos', { token, method: 'POST', body, headers }), ['photos']) as unknown as { assetId: string };
    expect(getAsset(result.assetId).rating).toBe(2);
    const raw = lrRequest('photos', { token, method: 'POST', body: new Uint8Array(bytes), headers: { 'content-type': 'image/jpeg', 'content-length': String(bytes.length) } });
    await expect(handleLightroom(raw, ['photos'])).rejects.toThrow('multipart');
    const unsized = lrRequest('photos', { token, method: 'POST', body, headers: { 'content-type': headers['content-type'] } });
    await expect(handleLightroom(unsized, ['photos'])).rejects.toThrow('50 MiB');
  });
});
