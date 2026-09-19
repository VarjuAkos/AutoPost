import { AppError } from './db';

export function guard(request: Request) {
  const url = new URL(request.url);
  const host = request.headers.get('host') || '';
  const local = /^(localhost|127\.0\.0\.1)(?::([0-9]{1,5}))?$/i.exec(host);
  if (!local || (local[2] && (+local[2] < 1 || +local[2] > 65535))) throw new AppError('This studio is only available on localhost.', 403);
  const expectedOrigin = new URL(`${url.protocol}//${host}`).origin;
  const origin = request.headers.get('origin');
  if (origin && origin !== expectedOrigin) throw new AppError('Cross-origin access is not allowed.', 403);
  if (!['GET', 'HEAD'].includes(request.method) && !origin) throw new AppError('A same-origin browser request is required.', 403);
}
