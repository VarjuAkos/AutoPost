import { AppError } from './db';
import { verifyIntegrationToken } from './tokens';

export function assertLocalHost(request: Request) {
  const host = request.headers.get('host') || '';
  const local = /^(localhost|127\.0\.0\.1)(?::([0-9]{1,5}))?$/i.exec(host);
  if (!local || (local[2] && (+local[2] < 1 || +local[2] > 65535))) throw new AppError('This studio is only available on localhost.', 403);
  return host;
}

export function guard(request: Request) {
  const url = new URL(request.url);
  const host = assertLocalHost(request);
  const expectedOrigin = new URL(`${url.protocol}//${host}`).origin;
  const origin = request.headers.get('origin');
  if (origin && origin !== expectedOrigin) throw new AppError('Cross-origin access is not allowed.', 403);
  if (!['GET', 'HEAD'].includes(request.method) && !origin) throw new AppError('A same-origin browser request is required.', 403);
}

export async function readJson(request: Request) {
  if (!request.body) throw new AppError('Request body required.');
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > 2 * 1024 * 1024) { await reader.cancel(); throw new AppError('Request is too large.', 413); }
    chunks.push(value);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw new AppError('Invalid JSON.'); }
}

export function guardIntegration(request: Request, kind: string) {
  assertLocalHost(request);
  if (request.headers.has('origin')) throw new AppError('Integration endpoints do not accept browser requests.', 403);
  const match = /^Bearer ([A-Za-z0-9_-]{20,200})$/.exec(request.headers.get('authorization') || '');
  if (!match || !verifyIntegrationToken(kind, match[1])) throw new AppError('Lightroom is not paired or the token was revoked.', 401);
}
