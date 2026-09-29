import { ZipArchive } from 'archiver';
import { Readable, PassThrough } from 'node:stream';
import { AppError, getProject } from './db';
import { renderSlide } from './images';
import type { Post, Project } from '../domain';

const asciiName = (title: string) => title.replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 60);
export const folderName = (post: Post, index: number) => `${String(index + 1).padStart(2, '0')} ${post.title.replace(/[\u0000-\u001f\u007f/\\:*?"<>|]/g, '-').replace(/^[\s.]+|[\s.]+$/g, '').slice(0, 80) || 'Story'}`;

function zipResponse(project: Project, entries: { post: Post; folder: string }[], filename: string) {
  const output = new PassThrough();
  const archive = new ZipArchive({ store: true });
  archive.on('error', () => output.destroy(new Error('Export failed.')));
  archive.on('warning', () => output.destroy(new Error('Export failed.')));
  output.on('close', () => archive.abort());
  archive.pipe(output);
  void (async () => {
    for (const { post, folder } of entries) {
      for (let index = 0; index < post.slides.length; index++) {
        if (output.destroyed) return;
        const slide = post.slides[index];
        const asset = project.assets.find(a => a.id === slide.assetId);
        if (!asset) throw new AppError('An export photo is missing.');
        const bytes = await renderSlide(asset, slide.frame, post.ratio);
        archive.append(bytes, { name: `${folder}${String(index + 1).padStart(2, '0')}.jpg` });
      }
    }
    await archive.finalize();
  })().catch(() => output.destroy(new Error('Export failed. Please retry.')));
  return new Response(Readable.toWeb(output) as ReadableStream<Uint8Array>, { headers: {
    'Content-Type': 'application/zip',
    'Content-Disposition': `attachment; filename="${filename}.zip"`,
    'Cache-Control': 'no-store',
  } });
}

export function exportPost(projectId: string, postId: string) {
  const project = getProject(projectId);
  const post = project.document.posts.find(p => p.id === postId);
  if (!post || !post.slides.length) throw new AppError('Add photos before exporting.');
  return zipResponse(project, [{ post, folder: '' }], asciiName(post.title) || 'carousel');
}

export function exportAll(projectId: string) {
  const project = getProject(projectId);
  const entries = project.document.posts.map((post, index) => ({ post, folder: `${folderName(post, index)}/` })).filter(e => e.post.slides.length);
  if (!entries.length) throw new AppError('Add photos to a story before exporting.');
  return zipResponse(project, entries, asciiName(project.document.title) || 'stories');
}
