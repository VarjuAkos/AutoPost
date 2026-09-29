import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { db } from './db';

const digest = (token: string) => createHash('sha256').update(token).digest();
type Row = { hash: string; createdAt: string; lastUsedAt: string | null };

export function tokenStatus(kind: string) {
  const row = db().prepare('SELECT createdAt, lastUsedAt FROM integration_tokens WHERE kind = ?').get(kind) as Omit<Row, 'hash'> | undefined;
  return { paired: Boolean(row), createdAt: row?.createdAt ?? null, lastUsedAt: row?.lastUsedAt ?? null };
}
export function createIntegrationToken(kind: string) {
  const token = `ap_${randomBytes(32).toString('base64url')}`;
  db().prepare('INSERT OR REPLACE INTO integration_tokens (kind, hash, createdAt, lastUsedAt) VALUES (?, ?, ?, NULL)').run(kind, digest(token).toString('hex'), new Date().toISOString());
  return token;
}
export function revokeIntegrationToken(kind: string) {
  db().prepare('DELETE FROM integration_tokens WHERE kind = ?').run(kind);
}
export function verifyIntegrationToken(kind: string, token: string) {
  const row = db().prepare('SELECT hash FROM integration_tokens WHERE kind = ?').get(kind) as Pick<Row, 'hash'> | undefined;
  if (!row) return false;
  const expected = Buffer.from(row.hash, 'hex');
  const actual = digest(token);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return false;
  db().prepare('UPDATE integration_tokens SET lastUsedAt = ? WHERE kind = ?').run(new Date().toISOString(), kind);
  return true;
}
