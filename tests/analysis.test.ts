import { beforeEach, describe, expect, it, vi } from 'vitest';
import sharp from 'sharp';
import { z } from 'zod';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import type Anthropic from '@anthropic-ai/sdk';
import { createProject, db, saveProject } from '../src/lib/server/db';
import { importPhoto } from '../src/lib/server/storage';
import { analyze, ANALYSIS_VERSION, cachedAnalysis, curate } from '../src/lib/server/ai/curation';
import { newPost, type Asset, type Project } from '../src/lib/domain';

const provider = vi.hoisted(() => vi.fn());
vi.mock('../src/lib/server/ai/client', () => ({ structuredCall: provider }));
const details = (subject: string) => ({ subject, palette: 'Warm red', light: 'Even', composition: 'Wide frame with negative space', mood: 'Quiet', role: 'Establishing image' });
let project: Project;
let assets: Asset[];
const runId = () => crypto.randomUUID();
function seed(asset: Asset, subject: string) {
  db().prepare('INSERT INTO analyses (assetId, version, content) VALUES (?, ?, ?)').run(asset.id, ANALYSIS_VERSION, JSON.stringify({ assetId: asset.id, ...details(subject) }));
}
beforeEach(async () => {
  provider.mockReset();
  project = createProject('Synthetic reference mapping');
  assets = [];
  for (const color of ['#ab5544', '#4466aa']) {
    const image = await sharp({ create: { width: 24, height: 16, channels: 3, background: color } }).jpeg().toBuffer();
    assets.push((await importPhoto(project.id, 'fixture.jpg', image)).asset);
  }
});

describe('analysis photo identity', () => {
  it('rejects inconsistent legacy IDs without writing any analysis', async () => {
    provider.mockResolvedValue({ data: { photos: [{ assetId: assets[0].id, ...details('First') }, { assetId: crypto.randomUUID(), ...details('Wrong') }] }, cost: 0.001 });
    await expect(analyze(project.id, assets.map(a => a.id), runId())).rejects.toThrow('No analysis was accepted');
    expect(assets.map(a => cachedAnalysis(a.id))).toEqual([null, null]);
    expect(provider).toHaveBeenCalledTimes(1);
  });
  it('uses required named slots, never model-copied UUIDs or response order', async () => {
    provider.mockImplementation(async (schema: z.ZodType, _system: string, content: Anthropic.ContentBlockParam[]) => {
      const output = { photo_2: details('Blue'), photo_1: details('Red') };
      expect(schema.safeParse(output).success).toBe(true);
      expect(zodOutputFormat(schema).schema).toMatchObject({ required: ['photo_1', 'photo_2'], additionalProperties: false });
      const text = JSON.stringify(content.filter(c => c.type === 'text'));
      for (const asset of assets) expect(text).not.toContain(asset.id);
      expect(text).toContain('photo_1');
      expect(text).toContain('photo_2');
      expect(content.filter(c => c.type === 'image')).toHaveLength(2);
      return { data: output, cost: 0.001 };
    });
    await analyze(project.id, assets.map(a => a.id), runId());
    expect(cachedAnalysis(assets[0].id)?.subject).toBe('Red');
    expect(cachedAnalysis(assets[1].id)?.subject).toBe('Blue');
  });
  it('preserves old valid cache entries and maps a partial cache hit to the correct photo', async () => {
    seed(assets[0], 'Already analyzed');
    provider.mockImplementation(async (schema: z.ZodType, _system: string, content: Anthropic.ContentBlockParam[]) => {
      const output = { photo_1: details('New second photo') };
      expect(schema.safeParse(output).success).toBe(true);
      expect(content.filter(c => c.type === 'image')).toHaveLength(1);
      return { data: output, cost: 0.001 };
    });
    await expect(analyze(project.id, assets.map(a => a.id), runId())).resolves.toMatchObject({ analyzed: 2, cached: 1 });
    expect(cachedAnalysis(assets[0].id)?.subject).toBe('Already analyzed');
    expect(cachedAnalysis(assets[1].id)?.subject).toBe('New second photo');
  });
  it.each(['missing', 'unexpected', 'injected-id'])('rejects %s slot data atomically without retries', async kind => {
    const data = kind === 'missing' ? { photo_1: details('First') }
      : kind === 'unexpected' ? { photo_1: details('First'), photo_2: details('Second'), photo_99: details('Unknown') }
        : { photo_1: { ...details('First'), assetId: assets[1].id }, photo_2: details('Second') };
    provider.mockResolvedValue({ data, cost: 0.001 });
    await expect(analyze(project.id, assets.map(a => a.id), runId())).rejects.toThrow('No analysis was accepted');
    expect(assets.map(a => cachedAnalysis(a.id))).toEqual([null, null]);
    expect(provider).toHaveBeenCalledTimes(1);
  });
  it('makes no request when every requested photo is cached', async () => {
    for (const asset of assets) seed(asset, 'Cached');
    await expect(analyze(project.id, assets.map(a => a.id), runId())).resolves.toEqual({ analyzed: 2, cached: 2, cost: 0 });
    expect(provider).not.toHaveBeenCalled();
  });
});

describe('curation photo assignments', () => {
  const posts = [{ title: 'A sequence', rationale: 'Contrast.', treatment: 'white' }];
  const assign = (slots: Record<string, string>) => Object.entries(slots).map(([photoRef, slot]) => ({ photoRef, slot }));
  it('rules out per-post photo lists and maps explicit references and positions rather than array order', async () => {
    for (const asset of assets) seed(asset, 'Cached');
    provider.mockImplementation(async (schema: z.ZodType, _system: string, content: Anthropic.ContentBlockParam[], _maxTokens: number, _runId: string, model: string) => {
      expect(schema.safeParse({ posts: [{ ...posts[0], photoRefs: ['photo_1', 'photo_1'] }] }).success).toBe(false);
      const output = { posts, assignments: assign({ photo_2: 'post_1_slide_1', photo_1: 'post_1_slide_2' }) };
      expect(schema.safeParse(output).success).toBe(true);
      expect(zodOutputFormat(schema).schema).toMatchObject({ properties: { assignments: { type: 'array', items: { required: ['photoRef', 'slot'], additionalProperties: false, properties: { photoRef: { type: 'string' } } } } } });
      expect(schema.safeParse({ posts, assignments: assign({ photo_99: 'post_1_slide_1', photo_1: 'unused' }) }).success).toBe(false);
      expect(model).toBe('claude-sonnet-4-6');
      const text = JSON.stringify(content);
      for (const asset of assets) expect(text).not.toContain(asset.id);
      return { data: output, cost: 0.001 };
    });
    const result = await curate(project.id, assets.map(a => a.id), 'Editorial story', 1, '', runId());
    expect(result.posts[0].slides.map(s => s.assetId)).toEqual([assets[1].id, assets[0].id]);
    expect(ANALYSIS_VERSION).toBe('claude-haiku-4-5-20251001:editorial-v1');
  });
  it('preserves pins and framing through the assignment mapping', async () => {
    for (const asset of assets) seed(asset, 'Cached');
    const post = newPost(assets.map(a => a.id), 0);
    post.slides[0].pinned = true;
    post.slides[0].frame.background = '#101010';
    saveProject(project.id, project.revision, { ...project.document, posts: [post] });
    provider.mockResolvedValue({ data: { posts, assignments: assign({ photo_1: 'post_1_slide_1', photo_2: 'post_1_slide_2' }) }, cost: 0.001 });
    const result = await curate(project.id, assets.map(a => a.id), 'Editorial story', 1, '', runId(), post.id);
    expect(result.posts[0].slides[0]).toEqual(post.slides[0]);
  });
  it('keeps unused photos explicit without filling the carousel', async () => {
    for (const asset of assets) seed(asset, 'Cached');
    provider.mockResolvedValue({ data: { posts, assignments: assign({ photo_1: 'unused', photo_2: 'post_1_slide_1' }) }, cost: 0.001 });
    const result = await curate(project.id, assets.map(a => a.id), 'Editorial story', 1, '', runId());
    expect(result.posts[0].slides.map(s => s.assetId)).toEqual([assets[1].id]);
    expect(result.unusedIds).toEqual([assets[0].id]);
  });
  it.each(['unused', 'post_1_slide_2'])('rejects repeated explicit references even when one is %s', async slot => {
    for (const asset of assets) seed(asset, 'Cached');
    provider.mockResolvedValue({ data: { posts, assignments: [{ photoRef: 'photo_1', slot: 'post_1_slide_1' }, { photoRef: 'photo_1', slot }] }, cost: 0.001 });
    await expect(curate(project.id, assets.map(a => a.id), 'Editorial story', 1, '', runId())).rejects.toThrow('same photo more than once');
    expect(provider).toHaveBeenCalledTimes(1);
  });
  it.each<Record<string, string>>([
    { photo_1: 'post_1_slide_1', photo_2: 'post_1_slide_1' },
    { photo_1: 'post_1_slide_1', photo_2: 'post_1_slide_21' },
    { photo_1: 'post_1_slide_1', photo_2: 'post_1_slide_0' },
    { photo_1: 'post_1_slide_1', photo_2: 'post_1_slide_1.5' },
    { photo_1: 'post_1_slide_1', photo_2: 'invented-slot' },
    { photo_1: 'post_1_slide_1', photo_2: 'post_1_slide_2\n' },
    { photo_1: 'post_1_slide_1', photo_2: 'post_1_slide_3' },
    { photo_1: 'post_2_slide_1', photo_2: 'post_1_slide_1' },
    { photo_1: 'post_1_slide_1', photo_2: 'unused', photo_99: 'unused' },
    { photo_1: 'post_1_slide_1' },
    { photo_1: 'unused', photo_2: 'unused' },
  ])('rejects invalid assignments without guessing, retrying, or losing cached analyses: %j', async assignments => {
    for (const asset of assets) seed(asset, 'Cached');
    provider.mockResolvedValue({ data: { posts, assignments: assign(assignments) }, cost: 0.001 });
    await expect(curate(project.id, assets.map(a => a.id), 'Editorial story', 1, '', runId())).rejects.toThrow();
    expect(provider).toHaveBeenCalledTimes(1);
    expect(assets.every(asset => cachedAnalysis(asset.id)?.subject === 'Cached')).toBe(true);
  });
});
