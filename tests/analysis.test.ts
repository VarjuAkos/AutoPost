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

describe('curation photo references', () => {
  it('constrains short references and maps a reordered sequence back to real IDs', async () => {
    for (const asset of assets) seed(asset, 'Cached');
    provider.mockImplementation(async (schema: z.ZodType, _system: string, content: Anthropic.ContentBlockParam[]) => {
      const output = { posts: [{ title: 'A sequence', rationale: 'Contrast.', treatment: 'white', photoRefs: ['photo_2', 'photo_1'] }] };
      expect(schema.safeParse(output).success).toBe(true);
      expect(schema.safeParse({ posts: [{ ...output.posts[0], photoRefs: ['photo_99'] }] }).success).toBe(false);
      const text = JSON.stringify(content);
      for (const asset of assets) expect(text).not.toContain(asset.id);
      return { data: output, cost: 0.001 };
    });
    const result = await curate(project.id, assets.map(a => a.id), 'Editorial story', 1, '', runId());
    expect(result.posts[0].slides.map(s => s.assetId)).toEqual([assets[1].id, assets[0].id]);
  });
  it('preserves pins and framing through the reference mapping', async () => {
    for (const asset of assets) seed(asset, 'Cached');
    const post = newPost(assets.map(a => a.id), 0);
    post.slides[0].pinned = true;
    post.slides[0].frame.background = '#101010';
    saveProject(project.id, project.revision, { ...project.document, posts: [post] });
    provider.mockResolvedValue({ data: { posts: [{ title: 'Refined', rationale: 'A quieter sequence.', treatment: 'white', photoRefs: ['photo_1', 'photo_2'] }] }, cost: 0.001 });
    const result = await curate(project.id, assets.map(a => a.id), 'Editorial story', 1, '', runId(), post.id);
    expect(result.posts[0].slides[0]).toEqual(post.slides[0]);
  });
  it('rejects invalid references without falling back to positional guessing', async () => {
    for (const asset of assets) seed(asset, 'Cached');
    provider.mockResolvedValue({ data: { posts: [{ title: 'Invalid', rationale: '', treatment: 'white', photoRefs: ['photo_99'] }] }, cost: 0.001 });
    await expect(curate(project.id, assets.map(a => a.id), 'Editorial story', 1, '', runId())).rejects.toThrow('photo references');
  });
});
