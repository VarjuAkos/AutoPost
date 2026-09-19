import { randomUUID } from 'node:crypto';
import { AppError, db } from '../db';

export const MODEL = 'claude-haiku-4-5-20251001';
export const RUN_LIMIT = 0.5;
export function budgetStatus() {
  const limit = Number(process.env.AUTOPOST_AI_LIMIT_USD || '1');
  const row = db().prepare('SELECT COALESCE(SUM(COALESCE(actual, reserved)), 0) AS used FROM ai_usage').get() as { used: number };
  return { used: row.used, limit: Number.isFinite(limit) && limit > 0 ? limit : 1, model: MODEL, configured: Boolean(process.env.ANTHROPIC_API_KEY) };
}
export function reserveBudget(amount: number) {
  return db().transaction(() => {
    const status = budgetStatus();
    if (!Number.isFinite(amount) || amount <= 0 || amount > RUN_LIMIT) throw new AppError('This request exceeds the $0.50 per-request allowance. Choose fewer photos.');
    if (status.used + amount > status.limit) throw new AppError('The local AI allowance is exhausted. Manual editing and export still work.', 402);
    const id = randomUUID();
    db().prepare('INSERT INTO ai_usage (id, reserved, state, createdAt) VALUES (?, ?, ?, ?)').run(id, amount, 'reserved', new Date().toISOString());
    return id;
  })();
}
export function settleBudget(id: string, input: number, output: number) {
  const actual = (input + output * 5) / 1_000_000;
  db().prepare("UPDATE ai_usage SET actual = ?, state = 'completed' WHERE id = ? AND state = 'reserved'").run(actual, id);
  return actual;
}
export function failBudget(id: string) {
  db().prepare("UPDATE ai_usage SET state = 'uncertain' WHERE id = ?").run(id);
}
