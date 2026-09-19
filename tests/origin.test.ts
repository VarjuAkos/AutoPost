import { describe, expect, it } from 'vitest';
import { guard } from '../src/lib/server/http';

function request(host: string, origin?: string, method = 'POST') {
  const headers = new Headers({ host });
  if (origin !== undefined) headers.set('origin', origin);
  return new Request('http://localhost:3000/api/projects', { method, headers });
}

describe('local same-origin protection', () => {
  it('allows the real 127.0.0.1 origin when Next normalizes request.url to localhost', () => {
    expect(() => guard(request('127.0.0.1:3000', 'http://127.0.0.1:3000'))).not.toThrow();
  });
  it('allows the real localhost origin', () => {
    expect(() => guard(request('localhost:3000', 'http://localhost:3000'))).not.toThrow();
  });
  it('does not consider two different loopback hostnames the same origin', () => {
    expect(() => guard(request('127.0.0.1:3000', 'http://localhost:3000'))).toThrow();
  });
  it.each(['https://example.com', 'null', 'http://localhost:3001', 'http://localhost:3000/path', 'https://localhost:3000'])('rejects origin %s', origin => {
    expect(() => guard(request('localhost:3000', origin))).toThrow();
  });
  it.each(['example.com:3000', '127.0.0.1.example.com:3000', 'user@localhost:3000', 'localhost:99999'])('rejects host %s', host => {
    expect(() => guard(request(host, 'http://localhost:3000'))).toThrow();
  });
  it('requires an origin for mutations, not normal local reads', () => {
    expect(() => guard(request('localhost:3000'))).toThrow();
    expect(() => guard(request('localhost:3000', undefined, 'GET'))).not.toThrow();
  });
});
