import { z } from 'zod';

export const colorSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/);
export const frameSchema = z.object({
  mode: z.enum(['fit', 'fill']),
  background: colorSchema,
  margin: z.number().min(0).max(0.2),
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
  zoom: z.number().min(1).max(3),
});
export type Frame = z.infer<typeof frameSchema>;
export const defaultFrame: Frame = { mode: 'fit', background: '#ffffff', margin: 0.04, x: 0.5, y: 0.5, zoom: 1 };
export const slideSchema = z.object({ id: z.uuid(), assetId: z.uuid(), frame: frameSchema, pinned: z.boolean() });
export type Slide = z.infer<typeof slideSchema>;
export const postSchema = z.object({
  id: z.uuid(), title: z.string().min(1).max(120), rationale: z.string().max(1000),
  status: z.enum(['draft', 'accepted']), lens: z.string().max(80), ratio: z.literal('4:5'),
  frame: frameSchema, slides: z.array(slideSchema).max(20),
  position: z.object({ x: z.number().min(-10000).max(10000), y: z.number().min(-10000).max(10000) }),
});
export type Post = z.infer<typeof postSchema>;
export const documentSchema = z.object({
  title: z.string().trim().min(1).max(100), posts: z.array(postSchema).max(100),
  sections: z.record(z.uuid(), z.string().max(60)),
  viewport: z.object({ x: z.number().min(-100000).max(100000), y: z.number().min(-100000).max(100000), zoom: z.number().min(0.2).max(2) }),
});
export type ProjectDocument = z.infer<typeof documentSchema>;
export type Asset = { id: string; projectId: string; filename: string; hash: string; width: number; height: number; bytes: number; capturedAt: string | null; createdAt: string; derivativeFormat?: 'jpeg' | 'png' };
export type Project = { id: string; revision: number; createdAt: string; document: ProjectDocument; assets: Asset[] };
export type ProjectSummary = { id: string; title: string; count: number; postCount: number; covers: string[]; createdAt: string };
export type Lens = 'Editorial story' | 'Color & mood' | 'Chronology';
export const CURATION_LIMITS = { photos: 500, posts: 20, analysisBatch: 6, maxRunUsd: 20 } as const;
export const curationRangeSchema = z.object({ minSlides: z.number().int().min(1).max(20), maxSlides: z.number().int().min(1).max(20) }).refine(value => value.minSlides <= value.maxSlides, 'Minimum photos cannot exceed maximum photos.');
export type CurationRange = z.infer<typeof curationRangeSchema>;
export const assetUrl = (id: string, size: 'thumb' | 'preview' = 'thumb') => `/api/assets/${id}?size=${size}`;

export function newSlide(assetId: string, frame: Frame = defaultFrame): Slide {
  return { id: crypto.randomUUID(), assetId, frame: { ...frame }, pinned: false };
}
export function newPost(assetIds: string[], index: number, title = 'Untitled story'): Post {
  return { id: crypto.randomUUID(), title, rationale: '', status: 'accepted', lens: 'Manual', ratio: '4:5', frame: { ...defaultFrame }, slides: assetIds.slice(0, 20).map(id => newSlide(id)), position: { x: (index % 5) * 360, y: Math.floor(index / 5) * 470 } };
}
export function reorder<T>(items: T[], from: number, to: number): T[] {
  if (from < 0 || to < 0 || from >= items.length || to >= items.length) return items;
  const result = [...items];
  result.splice(to, 0, result.splice(from, 1)[0]);
  return result;
}
export function validateDocument(doc: ProjectDocument, assetIds: Set<string>) {
  const postIds = new Set<string>();
  const slideIds = new Set<string>();
  for (const post of doc.posts) {
    if (postIds.has(post.id)) throw new Error('Post IDs must be unique.');
    postIds.add(post.id);
    for (const slide of post.slides) {
      if (!assetIds.has(slide.assetId)) throw new Error('A slide references a photo outside this project.');
      if (slideIds.has(slide.id)) throw new Error('Slide IDs must be unique.');
      slideIds.add(slide.id);
    }
  }
  for (const id of Object.keys(doc.sections)) if (!assetIds.has(id)) throw new Error('Unknown photo section.');
}
