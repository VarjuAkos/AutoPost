import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import { AppError, createProject, getAsset, getProject, listProjects, saveProject } from '@/lib/server/db';
import { assetPath, importPhoto, readUpload, withImportSlot } from '@/lib/server/storage';
import { CURATION_LIMITS, documentSchema } from '@/lib/domain';
import { exportAll, exportPost } from '@/lib/server/export';
import { approveRun, budgetStatus } from '@/lib/server/ai/budget';
import { analyze, cachedAnalysis, curate } from '@/lib/server/ai/curation';
import { guard, readJson as body } from '@/lib/server/http';
import { checkConnection } from '@/lib/server/ai/client';
import { handleLightroom, LIGHTROOM } from '@/lib/server/lightroom';
import { createIntegrationToken, revokeIntegrationToken, tokenStatus } from '@/lib/server/tokens';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const json = (value: unknown, status = 200) => Response.json(value, { status, headers: { 'Cache-Control': 'no-store' } });
const selectionSchema = z.object({ assetIds: z.array(z.uuid()).min(1).max(CURATION_LIMITS.photos), consent: z.literal(true), runId: z.uuid(), budgetUsd: z.number().min(0.05).max(CURATION_LIMITS.maxRunUsd).default(0.5) });
type Context = { params: Promise<{ path: string[] }> };

async function handle(request: Request, context: Context) {
  try {
    const { path: parts } = await context.params;
    if (parts[0] === 'integrations' && parts[1] === LIGHTROOM && parts[2] !== 'token') return json(await handleLightroom(request, parts.slice(2)));
    guard(request);
    const [resource, id, action, postId, tail] = parts;
    const method = request.method;
    if (resource === 'integrations' && id === LIGHTROOM && action === 'token' && parts.length === 3) {
      if (method === 'GET') return json(tokenStatus(LIGHTROOM));
      if (method === 'POST') return json({ token: createIntegrationToken(LIGHTROOM) }, 201);
      if (method === 'DELETE') { revokeIntegrationToken(LIGHTROOM); return json(tokenStatus(LIGHTROOM)); }
    }
    if (resource === 'settings' && method === 'GET' && parts.length === 1) return json(budgetStatus());
    if (resource === 'settings' && id === 'check' && method === 'POST' && parts.length === 2) {
      z.object({ consent: z.literal(true) }).parse(await body(request));
      return json(await checkConnection());
    }
    if (resource === 'assets' && method === 'GET' && parts.length === 2) {
      const asset = getAsset(z.uuid().parse(id));
      const size = new URL(request.url).searchParams.get('size') === 'preview' ? 'preview' : 'thumb';
      const etag = `"${asset.hash.slice(0, 24)}-${size}"`;
      const headers = { 'Cache-Control': 'private, no-cache', ETag: etag, 'X-Content-Type-Options': 'nosniff' };
      if (request.headers.get('if-none-match') === etag) return new Response(null, { status: 304, headers });
      return new Response(new Uint8Array(await readFile(assetPath(asset.id, size, asset.derivativeFormat))), { headers: { ...headers, 'Content-Type': `image/${asset.derivativeFormat || 'jpeg'}` } });
    }
    if (resource !== 'projects') throw new AppError('Not found.', 404);
    if (parts.length === 1) {
      if (method === 'GET') return json(listProjects());
      if (method === 'POST') return json(createProject(z.object({ title: z.string().trim().min(1).max(100) }).parse(await body(request)).title), 201);
    }
    z.uuid().parse(id);
    if (parts.length === 2) {
      if (method === 'GET') return json(getProject(id));
      if (method === 'PUT') {
        const input = z.object({ revision: z.number().int().nonnegative(), document: documentSchema }).parse(await body(request));
        return json({ revision: saveProject(id, input.revision, input.document) });
      }
    }
    if (action === 'assets' && method === 'POST' && parts.length === 3) {
      return await withImportSlot(async () => {
        const filename = decodeURIComponent(request.headers.get('x-file-name') || 'photo.jpg');
        return json(await importPhoto(id, filename, await readUpload(request)), 201);
      });
    }
    if (action === 'analysis' && method === 'GET' && parts.length === 3) return json({ ids: getProject(id).assets.filter(a => cachedAnalysis(a.id)).map(a => a.id) });
    if (action === 'analyze' && method === 'POST' && parts.length === 3) {
      const input = selectionSchema.extend({ assetIds: z.array(z.uuid()).min(1).max(CURATION_LIMITS.analysisBatch) }).parse(await body(request));
      approveRun(input.runId, id, input.budgetUsd);
      return json(await analyze(id, input.assetIds, input.runId));
    }
    if (action === 'curate' && method === 'POST' && parts.length === 3) {
      const input = selectionSchema.extend({ lens: z.enum(['Editorial story', 'Color & mood', 'Chronology']), count: z.number().int().min(1).max(CURATION_LIMITS.posts).nullable(), minSlides: z.number().int().min(1).max(20).default(1), maxSlides: z.number().int().min(1).max(20).default(20), brief: z.string().max(800), targetId: z.uuid().optional() }).refine(value => value.minSlides <= value.maxSlides).parse(await body(request));
      approveRun(input.runId, id, input.budgetUsd);
      return json(await curate(id, input.assetIds, input.lens, input.count, input.brief, input.runId, input.targetId, { minSlides: input.minSlides, maxSlides: input.maxSlides }));
    }
    if (action === 'export' && method === 'POST' && parts.length === 3) return exportAll(id);
    if (action === 'posts' && tail === 'export' && method === 'POST' && parts.length === 5) return exportPost(id, z.uuid().parse(postId));
    throw new AppError('Not found.', 404);
  } catch (error) {
    if (error instanceof AppError) return json({ error: error.message }, error.status);
    if (error instanceof z.ZodError) return json({ error: 'The request contains invalid or out-of-range values.' }, 400);
    return json({ error: 'The operation could not be completed. Your original photos are unchanged.' }, 500);
  }
}
export const GET = handle;
export const POST = handle;
export const PUT = handle;
export const DELETE = handle;
