import { beforeEach, describe, expect, it, vi } from 'vitest';
import type Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { createProject, db } from '../src/lib/server/db';
import { ANALYSIS_VERSION, curate } from '../src/lib/server/ai/curation';
import { newPost, postSchema, type Asset } from '../src/lib/domain';
import { POST } from '../src/app/api/[...path]/route';

const provider = vi.hoisted(() => vi.fn());
vi.mock('../src/lib/server/ai/client', () => ({ structuredCall: provider }));
beforeEach(() => { provider.mockReset(); });
function collection(size: number) {
  const project = createProject('Large synthetic collection');
  const assets: Asset[] = [];
  db().transaction(() => {
    for (let index = 0; index < size; index++) {
      const asset: Asset = { id: crypto.randomUUID(), projectId: project.id, filename: `photo-${index}.jpg`, hash: `synthetic-${index}`, width: 600, height: 400, bytes: 100, capturedAt: null, createdAt: new Date().toISOString() };
      db().prepare('INSERT INTO assets (id, projectId, hash, metadata) VALUES (?, ?, ?, ?)').run(asset.id, project.id, asset.hash, JSON.stringify(asset));
      db().prepare('INSERT INTO analyses (assetId, version, content) VALUES (?, ?, ?)').run(asset.id, ANALYSIS_VERSION, JSON.stringify({ assetId: asset.id, subject: `Scene ${index}`, palette: 'Warm', light: 'Sunset', composition: 'Wide', mood: 'Quiet', role: 'Establishing' }));
      assets.push(asset);
    }
  })();
  return { project, assets };
}
const output = (count: number, size: number, offset = 0) => ({
  posts: Array.from({ length: count }, (_, i) => ({ title: `Story ${i + 1}`, rationale: 'A distinct highlight sequence.', treatment: 'white' })),
  assignments: Array.from({ length: size }, (_, i) => ({
    photoRef: `photo_${i + 1}`, slot: i < offset || i >= offset + count * 3 ? 'unused' : `post_${Math.floor((i - offset) / 3) + 1}_slide_${(i - offset) % 3 + 1}`,
  })),
});

describe('collection-scale curation', () => {
  it.each([170, 300, 500])('considers every descriptor in a %i-photo collection and can choose the final photos', async size => {
    const { project, assets } = collection(size);
    provider.mockImplementation(async (schema: z.ZodType, _system: string, content: Anthropic.ContentBlockParam[], maxTokens: number, _runId: string, model: string) => {
      const prompt = (content[0] as Anthropic.TextBlockParam).text;
      expect(prompt).toContain(`photo_${size}`);
      expect(prompt).toContain('Highlights');
      expect(prompt).toContain('analysis batch');
      const result = output(12, size, size - 36);
      expect(schema.safeParse(result).success).toBe(true);
      const format = JSON.stringify(zodOutputFormat(schema).schema);
      expect(format).toContain(`photo_${size}`);
      expect(format).not.toContain('anyOf');
      expect(format).not.toContain('photoRefs');
      expect(format).not.toContain('pattern');
      expect(format.length).toBeLessThan(10000);
      expect(maxTokens).toBeGreaterThan(size * 30);
      expect(model).toBe('claude-sonnet-4-6');
      return { data: result, cost: 0.01 };
    });
    const result = await curate(project.id, assets.map(a => a.id), 'Editorial story', 12, '', crypto.randomUUID(), undefined, { minSlides: 3, maxSlides: 5 });
    expect(result.posts).toHaveLength(12);
    expect(result.posts.at(-1)?.slides.at(-1)?.assetId).toBe(assets.at(-1)?.id);
    const chosen = result.posts.flatMap(post => post.slides.map(slide => slide.assetId));
    expect(new Set(chosen).size).toBe(chosen.length);
    expect(result.consideredCount).toBe(size);
    expect(result.unusedIds).toHaveLength(size - 36);
  });
  it('accepts 300 photos and 12 posts through the actual API validation', async () => {
    const { project, assets } = collection(300);
    provider.mockResolvedValue({ data: output(12, 300), cost: 0.01 });
    const response = await POST(new Request(`http://127.0.0.1:3000/api/projects/${project.id}/curate`, {
      method: 'POST', headers: { host: '127.0.0.1:3000', origin: 'http://127.0.0.1:3000', 'content-type': 'application/json' },
      body: JSON.stringify({ assetIds: assets.map(a => a.id), count: 12, minSlides: 3, maxSlides: 5, lens: 'Editorial story', brief: '', runId: crypto.randomUUID(), budgetUsd: 0.5, consent: true }),
    }), { params: Promise.resolve({ path: ['projects', project.id, 'curate'] }) });
    expect(response.status).toBe(200);
    const result = await response.json();
    expect(result.consideredCount).toBe(300);
    expect(result.posts).toHaveLength(12);
  });
  it('rejects more than the explicit collection limit before an AI call', async () => {
    const { project, assets } = collection(501);
    await expect(curate(project.id, assets.map(a => a.id), 'Editorial story', null, '', crypto.randomUUID())).rejects.toThrow('No photos were silently excluded');
    expect(provider).not.toHaveBeenCalled();
  });
  it('allows the model to choose fewer posts in Auto mode', async () => {
    const { project, assets } = collection(30);
    provider.mockResolvedValue({ data: output(2, 30), cost: 0.01 });
    const result = await curate(project.id, assets.map(a => a.id), 'Color & mood', null, '', crypto.randomUUID(), undefined, { minSlides: 3, maxSlides: 8 });
    expect(result.posts).toHaveLength(2);
    expect(result.unusedIds).toHaveLength(24);
  });
  it('rejects assignments to an absent post in Auto mode', async () => {
    const { project, assets } = collection(30);
    const data = output(2, 30);
    data.assignments[29].slot = 'post_3_slide_1';
    provider.mockResolvedValue({ data, cost: 0.01 });
    await expect(curate(project.id, assets.map(a => a.id), 'Editorial story', null, '', crypto.randomUUID())).rejects.toThrow('missing post');
  });
  it('rejects an impossible count or reversed range before calling AI', async () => {
    const { project, assets } = collection(10);
    await expect(curate(project.id, assets.map(a => a.id), 'Editorial story', 5, '', crypto.randomUUID(), undefined, { minSlides: 3, maxSlides: 8 })).rejects.toThrow('enough');
    await expect(curate(project.id, assets.map(a => a.id), 'Editorial story', 1, '', crypto.randomUUID(), undefined, { minSlides: 8, maxSlides: 3 })).rejects.toThrow();
    expect(provider).not.toHaveBeenCalled();
  });
  it('enforces exact manual count and the slide range after generation', async () => {
    const { project, assets } = collection(20);
    provider.mockResolvedValue({ data: output(1, 20), cost: 0.01 });
    await expect(curate(project.id, assets.map(a => a.id), 'Editorial story', 2, '', crypto.randomUUID(), undefined, { minSlides: 3, maxSlides: 5 })).rejects.toThrow();
    provider.mockResolvedValue({ data: output(1, 20), cost: 0.01 });
    await expect(curate(project.id, assets.map(a => a.id), 'Editorial story', 1, '', crypto.randomUUID(), undefined, { minSlides: 4, maxSlides: 5 })).rejects.toThrow();
  });
  it('places even the 100th post inside the persisted board bounds', () => {
    expect(postSchema.safeParse(newPost([], 99)).success).toBe(true);
  });
});
