import { afterEach, describe, expect, it, vi } from 'vitest';
import { createProject, db } from '../src/lib/server/db';
import { approveRun, budgetStatus, failBudget, reserveBudget, settleBudget } from '../src/lib/server/ai/budget';
import { validateProposal, type Proposal } from '../src/lib/server/ai/curation';
import { newPost } from '../src/lib/domain';

function rollbackTest(work: () => void) {
  const rollback = new Error('rollback test transaction');
  try { db().transaction(() => { work(); throw rollback; })(); }
  catch (error) { if (error !== rollback) throw error; }
}
afterEach(() => vi.unstubAllEnvs());

describe('AI spending limits without paid calls', () => {
  it('honors an explicitly approved allowance and prevents changing it during resume', () => {
    vi.stubEnv('AUTOPOST_AI_LIMIT_USD', '100');
    rollbackTest(() => {
      const project = createProject('Run approval');
      const run = crypto.randomUUID();
      approveRun(run, project.id, 1);
      reserveBudget(0.6, run);
      expect(() => approveRun(run, project.id, 1)).not.toThrow();
      expect(() => approveRun(run, project.id, 2)).toThrow('new run');
      expect(() => reserveBudget(0.5, run)).toThrow('$1.00');
    });
  });
  it('keeps approved runs project-scoped and below the global allowance', () => {
    rollbackTest(() => {
      vi.stubEnv('AUTOPOST_AI_LIMIT_USD', '1');
      const project = createProject('Scope one');
      const other = createProject('Scope two');
      const run = crypto.randomUUID();
      expect(() => approveRun(run, project.id, 2)).toThrow('total');
      approveRun(run, project.id, 0.5);
      expect(() => approveRun(run, other.id, 0.5)).toThrow('another project');
    });
  });
  it('separates recorded usage from pending and uncertain reservations', () => {
    vi.stubEnv('AUTOPOST_AI_LIMIT_USD', '100');
    rollbackTest(() => {
      const before = budgetStatus();
      const id = reserveBudget(0.1, crypto.randomUUID());
      expect(budgetStatus().reserved - before.reserved).toBeCloseTo(0.1);
      expect(budgetStatus().pending - before.pending).toBeCloseTo(0.1);
      failBudget(id);
      expect(budgetStatus().uncertain - before.uncertain).toBeCloseTo(0.1);
      const completed = reserveBudget(0.05, crypto.randomUUID());
      settleBudget(completed, 1000, 200);
      expect(budgetStatus().recorded - before.recorded).toBeCloseTo(0.002);
      expect(budgetStatus().used).toBeCloseTo(budgetStatus().recorded + budgetStatus().reserved);
    });
  });
  it('caps the entire multi-request curation, not just each individual request', () => {
    vi.stubEnv('AUTOPOST_AI_LIMIT_USD', '100');
    rollbackTest(() => {
      const run = crypto.randomUUID();
      reserveBudget(0.3, run);
      expect(() => reserveBudget(0.25, run)).toThrow('$0.50');
    });
  });
  it('counts unsettled reservations toward the total allowance', () => {
    rollbackTest(() => {
      const before = budgetStatus().used;
      vi.stubEnv('AUTOPOST_AI_LIMIT_USD', String(before + 0.4));
      reserveBudget(0.3, crypto.randomUUID());
      expect(() => reserveBudget(0.2, crypto.randomUUID())).toThrow('exhausted');
    });
  });
  it('settles actual usage and does not turn a completed bill into an uncertain one', () => {
    vi.stubEnv('AUTOPOST_AI_LIMIT_USD', '100');
    rollbackTest(() => {
      const id = reserveBudget(0.2, crypto.randomUUID());
      expect(settleBudget(id, 1000, 200)).toBe(0.002);
      failBudget(id);
      const row = db().prepare('SELECT state, actual FROM ai_usage WHERE id = ?').get(id);
      expect(row).toEqual({ state: 'completed', actual: 0.002 });
    });
  });
});

describe('editorial proposal validation', () => {
  const a = crypto.randomUUID();
  const b = crypto.randomUUID();
  const proposal = (ids: string[]): Proposal => ({ posts: [{ title: 'A story', rationale: 'A visual transition.', treatment: 'white', assetIds: ids }] });
  it('rejects unknown and repeated photos', () => {
    expect(() => validateProposal(proposal([crypto.randomUUID()]), new Set([a, b]), 1)).toThrow();
    expect(() => validateProposal(proposal([a, a]), new Set([a, b]), 1)).toThrow();
  });
  it('protects pinned positions during regeneration', () => {
    const post = newPost([a, b], 0);
    post.slides[0].pinned = true;
    expect(() => validateProposal(proposal([b, a]), new Set([a, b]), 1, post)).toThrow('pinned');
    expect(() => validateProposal(proposal([a, b]), new Set([a, b]), 1, post)).not.toThrow();
  });
});
