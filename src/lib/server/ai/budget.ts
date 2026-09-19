import { randomUUID } from 'node:crypto';
import { AppError, db, getProject } from '../db';
import { CURATION_LIMITS } from '../../domain';

export const MODEL = 'claude-haiku-4-5-20251001';
export const CURATION_MODEL = 'claude-sonnet-4-6';
const PRICING = { [MODEL]: { input: 1, output: 5 }, [CURATION_MODEL]: { input: 3, output: 15 } } as const;
export type AIModel = keyof typeof PRICING;
export function tokenCost(input: number, output: number, model: AIModel = MODEL) {
  const price = PRICING[model];
  return (input * price.input + output * price.output) / 1_000_000;
}
export const RUN_LIMIT = 0.5;
export function budgetStatus() {
  const limit = Number(process.env.AUTOPOST_AI_LIMIT_USD || '1');
  const row = db().prepare(`SELECT
    COALESCE(SUM(COALESCE(actual, 0)), 0) AS recorded,
    COALESCE(SUM(CASE WHEN actual IS NULL THEN reserved ELSE 0 END), 0) AS reserved,
    COALESCE(SUM(CASE WHEN actual IS NULL AND state = 'reserved' THEN reserved ELSE 0 END), 0) AS pending,
    COALESCE(SUM(CASE WHEN actual IS NULL AND state = 'uncertain' THEN reserved ELSE 0 END), 0) AS uncertain
    FROM ai_usage`).get() as { recorded: number; reserved: number; pending: number; uncertain: number };
  return { ...row, used: row.recorded + row.reserved, limit: Number.isFinite(limit) && limit > 0 ? limit : 1, model: MODEL, curationModel: CURATION_MODEL, configured: Boolean(process.env.ANTHROPIC_API_KEY) };
}
export function approveRun(runId: string, projectId: string, limitUsd: number) {
  getProject(projectId);
  if (!Number.isFinite(limitUsd) || limitUsd < 0.05 || limitUsd > CURATION_LIMITS.maxRunUsd) throw new AppError('Choose a run allowance between $0.05 and $20.');
  db().transaction(() => {
    const existing = db().prepare('SELECT projectId, limitUsd FROM ai_runs WHERE id = ?').get(runId) as { projectId: string; limitUsd: number } | undefined;
    if (existing) {
      if (existing.projectId !== projectId) throw new AppError('This run belongs to another project.');
      if (existing.limitUsd !== limitUsd) throw new AppError('Approve a new run before changing its allowance.');
      return;
    }
    if (limitUsd > budgetStatus().limit) throw new AppError('The run allowance exceeds the total application allowance.');
    const legacy = db().prepare('SELECT 1 FROM ai_run_links WHERE runId = ? LIMIT 1').get(runId);
    if (legacy && limitUsd !== RUN_LIMIT) throw new AppError('Approve a new run before changing a legacy run allowance.');
    db().prepare('INSERT INTO ai_runs (id, projectId, limitUsd, createdAt) VALUES (?, ?, ?, ?)').run(runId, projectId, limitUsd, new Date().toISOString());
  })();
}
export function reserveBudget(amount: number, runId: string) {
  return db().transaction(() => {
    const status = budgetStatus();
    const run = db().prepare('SELECT COALESCE(SUM(COALESCE(u.actual, u.reserved)), 0) AS used FROM ai_usage u JOIN ai_run_links r ON u.id = r.usageId WHERE r.runId = ?').get(runId) as { used: number };
    const approval = db().prepare('SELECT limitUsd FROM ai_runs WHERE id = ?').get(runId) as { limitUsd: number } | undefined;
    const runLimit = approval?.limitUsd ?? RUN_LIMIT;
    if (!Number.isFinite(amount) || amount <= 0 || run.used + amount > runLimit) throw new AppError(`This curation has reached its $${runLimit.toFixed(2)} allowance. Completed analyses remain cached. Approve a new run to continue.`, 402);
    if (status.used + amount > status.limit) throw new AppError('The local AI allowance is exhausted. Manual editing and export still work.', 402);
    const id = randomUUID();
    db().prepare('INSERT INTO ai_usage (id, reserved, state, createdAt) VALUES (?, ?, ?, ?)').run(id, amount, 'reserved', new Date().toISOString());
    db().prepare('INSERT INTO ai_run_links (runId, usageId) VALUES (?, ?)').run(runId, id);
    return id;
  })();
}
export function settleBudget(id: string, input: number, output: number, model: AIModel = MODEL) {
  const actual = tokenCost(input, output, model);
  db().prepare("UPDATE ai_usage SET actual = ?, state = 'completed' WHERE id = ? AND state = 'reserved'").run(actual, id);
  return actual;
}
export function rejectBudget(id: string) {
  db().prepare("UPDATE ai_usage SET actual = 0, state = 'rejected' WHERE id = ? AND state = 'reserved'").run(id);
}
export function failBudget(id: string) {
  db().prepare("UPDATE ai_usage SET state = 'uncertain' WHERE id = ? AND state = 'reserved'").run(id);
}
