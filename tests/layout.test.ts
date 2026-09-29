import { describe, expect, it } from 'vitest';
import { byCaptureTime, defaultFrame, newPost, reorder, validateDocument, type Asset } from '../src/lib/domain';
import { layout } from '../src/lib/layout';

describe('non-destructive framing', () => {
  it('fits the whole landscape with padding', () => {
    const rect = layout(3000, 2000, { ...defaultFrame, margin: 0 });
    expect(rect.source).toEqual({ x: 0, y: 0, width: 3000, height: 2000 });
    expect(rect.target).toEqual({ x: 0, y: 315, width: 1080, height: 720 });
  });
  it('preserves all of a portrait including its negative space', () => {
    expect(layout(2000, 3000, { ...defaultFrame, margin: 0 }).source).toEqual({ x: 0, y: 0, width: 2000, height: 3000 });
  });
  it('fills and pans without exposing canvas', () => {
    for (const x of [0, 0.5, 1]) {
      const { source, target } = layout(3000, 2000, { ...defaultFrame, mode: 'fill', x, zoom: 2 });
      expect(target).toEqual({ x: 0, y: 0, width: 1080, height: 1350 });
      expect(source.x).toBeGreaterThanOrEqual(0);
      expect(source.x + source.width).toBeLessThanOrEqual(3000);
    }
  });
  it('zooms a fitted photo past its edges, cropping inside the margin', () => {
    const { source, target } = layout(3000, 2000, { ...defaultFrame, margin: 0.05, zoom: 2.5 }, '3:4');
    expect(target).toEqual({ x: 54, y: 54, width: 972, height: 1332 });
    expect(source.width).toBeLessThan(3000);
    expect(source.x).toBeGreaterThan(0);
    expect(source.x + source.width).toBeLessThanOrEqual(3000);
  });
  it('rejects invalid dimensions', () => expect(() => layout(0, 20, defaultFrame)).toThrow());
  it('uses the taller 3:4 canvas when requested', () => {
    expect(layout(3000, 2000, { ...defaultFrame, mode: 'fill' }, '3:4').target).toEqual({ x: 0, y: 0, width: 1080, height: 1440 });
    expect(layout(3000, 2000, { ...defaultFrame, margin: 0 }, '3:4').target).toEqual({ x: 0, y: 360, width: 1080, height: 720 });
  });
});

describe('chronological photo order', () => {
  const asset = (filename: string, capturedAt: string | null): Asset => ({ id: filename, projectId: 'p', filename, hash: filename, width: 1, height: 1, bytes: 1, capturedAt, createdAt: '2026-01-01T00:00:00.000Z' });
  it('sorts by capture time, then undated photos by natural filename order', () => {
    const sorted = [asset('img10.jpg', null), asset('late.jpg', '2026-05-02T10:00:00.000Z'), asset('img2.jpg', null), asset('early.jpg', '2026-05-01T08:00:00.000Z')].sort(byCaptureTime);
    expect(sorted.map(a => a.filename)).toEqual(['early.jpg', 'late.jpg', 'img2.jpg', 'img10.jpg']);
  });
});

describe('document integrity', () => {
  it('reorders without mutating its input', () => {
    const input = ['a', 'b', 'c'];
    expect(reorder(input, 0, 2)).toEqual(['b', 'c', 'a']);
    expect(input).toEqual(['a', 'b', 'c']);
  });
  it('rejects foreign photos and duplicate slide IDs', () => {
    const assetId = crypto.randomUUID();
    const post = newPost([assetId], 0);
    const doc = { title: 'Test', posts: [post], sections: {}, viewport: { x: 0, y: 0, zoom: 1 } };
    expect(() => validateDocument(doc, new Set())).toThrow('outside');
    post.slides.push(post.slides[0]);
    expect(() => validateDocument(doc, new Set([assetId]))).toThrow('unique');
  });
});
