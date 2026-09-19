import { ZipArchive } from 'archiver';
import { Readable, PassThrough } from 'node:stream';
import { AppError, getProject } from './db';
import { renderSlide } from './images';

export function exportPost(projectId: string, postId: string) {
  const project = getProject(projectId);
  const post = project.document.posts.find(p => p.id === postId);
  if (!post || !post.slides.length) throw new AppError('Add photos before exporting.');
  const output = new PassThrough();
  const archive = new ZipArchive({ store: true });
  archive.on('error', () => output.destroy(new Error('Export failed.')));
  archive.on('warning', () => output.destroy(new Error('Export failed.')));
  output.on('close', () => archive.abort());
  archive.pipe(output);
  void (async () => {
    for (let index = 0; index < post.slides.length; index++) {
      if (output.destroyed) return;
      const slide = post.slides[index];
      const asset = project.assets.find(a => a.id === slide.assetId);
      if (!asset) throw new AppError('An export photo is missing.');
      const bytes = await renderSlide(asset, slide.frame);
      archive.append(bytes, { name: `${String(index + 1).padStart(2, '0')}.jpg` });
    }
    await archive.finalize();
  })().catch(() => output.destroy(new Error('Export failed. Please retry.')));
  return new Response(Readable.toWeb(output) as ReadableStream<Uint8Array>, { headers: {
    'Content-Type': 'application/zip',
    'Content-Disposition': `attachment; filename="${post.title.replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 60) || 'carousel'}.zip"`,
    'Cache-Control': 'no-store',
  } });
}
