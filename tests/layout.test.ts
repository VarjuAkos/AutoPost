import { describe, expect, it } from 'vitest';
import { defaultFrame, newPost, reorder, validateDocument } from '../src/lib/domain';
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
  it('rejects invalid dimensions', () => expect(() => layout(0, 20, defaultFrame)).toThrow());
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
