import { randomUUID } from 'node:crypto';
import { AppError, db } from '../db';

export const MODEL = 'claude-haiku-4-5-20251001';
export const RUN_LIMIT = 0.5;
export function budgetStatus() {
  const limit = Number(process.env.AUTOPOST_AI_LIMIT_USD || '1');
  const row = db().prepare(`SELECT
    COALESCE(SUM(COALESCE(actual, 0)), 0) AS recorded,
    COALESCE(SUM(CASE WHEN actual IS NULL THEN reserved ELSE 0 END), 0) AS reserved,
    COALESCE(SUM(CASE WHEN actual IS NULL AND state = 'reserved' THEN reserved ELSE 0 END), 0) AS pending,
    COALESCE(SUM(CASE WHEN actual IS NULL AND state = 'uncertain' THEN reserved ELSE 0 END), 0) AS uncertain
    FROM ai_usage`).get() as { recorded: number; reserved: number; pending: number; uncertain: number };
  return { ...row, used: row.recorded + row.reserved, limit: Number.isFinite(limit) && limit > 0 ? limit : 1, model: MODEL, configured: Boolean(process.env.ANTHROPIC_API_KEY) };
}
export function reserveBudget(amount: number, runId: string) {
  return db().transaction(() => {
    const status = budgetStatus();
    const run = db().prepare('SELECT COALESCE(SUM(COALESCE(u.actual, u.reserved)), 0) AS used FROM ai_usage u JOIN ai_run_links r ON u.id = r.usageId WHERE r.runId = ?').get(runId) as { used: number };
    if (!Number.isFinite(amount) || amount <= 0 || run.used + amount > RUN_LIMIT) throw new AppError('This curation has reached its $0.50 allowance. Completed analyses remain cached.', 402);
    if (status.used + amount > status.limit) throw new AppError('The local AI allowance is exhausted. Manual editing and export still work.', 402);
    const id = randomUUID();
    db().prepare('INSERT INTO ai_usage (id, reserved, state, createdAt) VALUES (?, ?, ?, ?)').run(id, amount, 'reserved', new Date().toISOString());
    db().prepare('INSERT INTO ai_run_links (runId, usageId) VALUES (?, ?)').run(runId, id);
    return id;
  })();
}
export function settleBudget(id: string, input: number, output: number) {
  const actual = (input + output * 5) / 1_000_000;
  db().prepare("UPDATE ai_usage SET actual = ?, state = 'completed' WHERE id = ? AND state = 'reserved'").run(actual, id);
  return actual;
}
export function rejectBudget(id: string) {
  db().prepare("UPDATE ai_usage SET actual = 0, state = 'rejected' WHERE id = ? AND state = 'reserved'").run(id);
}
export function failBudget(id: string) {
  db().prepare("UPDATE ai_usage SET state = 'uncertain' WHERE id = ? AND state = 'reserved'").run(id);
}
