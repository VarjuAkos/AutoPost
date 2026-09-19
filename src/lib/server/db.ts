import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { documentSchema, validateDocument, type Asset, type Project, type ProjectDocument, type ProjectSummary } from '../domain';

export const dataRoot = process.env.AUTOPOST_TEST_SCOPE === 'unit'
  ? path.join(process.cwd(), '.test-data', 'unit')
  : process.env.AUTOPOST_TEST_SCOPE === 'browser'
    ? path.join(process.cwd(), '.test-data', 'browser')
    : path.join(process.cwd(), 'data');
const globalDb = globalThis as typeof globalThis & { autopostDb?: Database.Database };
export function db() {
  if (!globalDb.autopostDb) {
    mkdirSync(dataRoot, { recursive: true, mode: 0o700 });
    const connection = new Database(path.join(dataRoot, 'studio.sqlite'));
    connection.pragma('journal_mode = WAL');
    connection.pragma('foreign_keys = ON');
    connection.exec(`
      CREATE TABLE IF NOT EXISTS projects (id TEXT PRIMARY KEY, document TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 0, createdAt TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS assets (id TEXT PRIMARY KEY, projectId TEXT NOT NULL REFERENCES projects(id), hash TEXT NOT NULL, metadata TEXT NOT NULL, UNIQUE(projectId, hash));
      CREATE TABLE IF NOT EXISTS analyses (assetId TEXT NOT NULL REFERENCES assets(id), version TEXT NOT NULL, content TEXT NOT NULL, PRIMARY KEY(assetId, version));
      CREATE TABLE IF NOT EXISTS ai_usage (id TEXT PRIMARY KEY, reserved REAL NOT NULL, actual REAL, state TEXT NOT NULL, createdAt TEXT NOT NULL);
    `);
    globalDb.autopostDb = connection;
  }
  globalDb.autopostDb.exec('CREATE TABLE IF NOT EXISTS ai_run_links (runId TEXT NOT NULL, usageId TEXT NOT NULL UNIQUE REFERENCES ai_usage(id))');
  globalDb.autopostDb.exec('CREATE TABLE IF NOT EXISTS ai_runs (id TEXT PRIMARY KEY, projectId TEXT NOT NULL REFERENCES projects(id), limitUsd REAL NOT NULL, createdAt TEXT NOT NULL)');
  return globalDb.autopostDb;
}
export class AppError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}
export function getAssets(projectId: string): Asset[] {
  return (db().prepare('SELECT metadata FROM assets WHERE projectId = ? ORDER BY rowid').all(projectId) as { metadata: string }[]).map(row => JSON.parse(row.metadata));
}
export function getAsset(id: string): Asset {
  const row = db().prepare('SELECT metadata FROM assets WHERE id = ?').get(id) as { metadata: string } | undefined;
  if (!row) throw new AppError('Photo not found.', 404);
  return JSON.parse(row.metadata);
}
export function getProject(id: string): Project {
  const row = db().prepare('SELECT * FROM projects WHERE id = ?').get(id) as { id: string; document: string; revision: number; createdAt: string } | undefined;
  if (!row) throw new AppError('Project not found.', 404);
  return { ...row, document: JSON.parse(row.document), assets: getAssets(id) };
}
export function createProject(title: string): Project {
  const id = randomUUID();
  const document = documentSchema.parse({ title, posts: [], sections: {}, viewport: { x: 70, y: 70, zoom: 0.85 } });
  db().prepare('INSERT INTO projects (id, document, createdAt) VALUES (?, ?, ?)').run(id, JSON.stringify(document), new Date().toISOString());
  return getProject(id);
}
export function listProjects(): ProjectSummary[] {
  return (db().prepare('SELECT id FROM projects ORDER BY createdAt DESC').all() as { id: string }[]).map(({ id }) => {
    const p = getProject(id);
    return { id, title: p.document.title, count: p.assets.length, postCount: p.document.posts.length, covers: p.assets.slice(0, 4).map(a => a.id), createdAt: p.createdAt };
  });
}
export function saveProject(id: string, revision: number, document: ProjectDocument) {
  const parsed = documentSchema.parse(document);
  validateDocument(parsed, new Set(getAssets(id).map(a => a.id)));
  const result = db().prepare('UPDATE projects SET document = ?, revision = revision + 1 WHERE id = ? AND revision = ?').run(JSON.stringify(parsed), id, revision);
  if (!result.changes) throw new AppError('This project changed in another tab. Reload before editing further.', 409);
  return revision + 1;
}
