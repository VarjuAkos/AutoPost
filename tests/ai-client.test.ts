import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import Anthropic from '@anthropic-ai/sdk';
import { structuredCall } from '../src/lib/server/ai/client';
import { budgetStatus } from '../src/lib/server/ai/budget';

const calls = vi.hoisted(() => ({ countTokens: vi.fn(), parse: vi.fn() }));
vi.mock('@anthropic-ai/sdk', () => {
  class AuthenticationError extends Error { status = 401; }
  class RateLimitError extends Error { status = 429; }
  class Client {
    static AuthenticationError = AuthenticationError;
    static RateLimitError = RateLimitError;
    messages = calls;
  }
  return { default: Client };
});
const schema = z.object({ answer: z.string() });
const call = () => structuredCall(schema, 'A test only.', [{ type: 'text', text: 'No real images or network calls.' }], 1000, crypto.randomUUID());
beforeEach(() => {
  vi.stubEnv('ANTHROPIC_API_KEY', 'test-placeholder-not-a-real-key');
  vi.stubEnv('AUTOPOST_AI_LIMIT_USD', '100');
  calls.countTokens.mockReset().mockResolvedValue({ input_tokens: 1000 });
  calls.parse.mockReset().mockResolvedValue({ parsed_output: { answer: 'ok' }, usage: { input_tokens: 1000, output_tokens: 200 } });
});
afterEach(() => { vi.unstubAllEnvs(); vi.useRealTimers(); });

describe('AI boundary with a mocked provider', () => {
  it('does not call the provider without credentials', async () => {
    vi.stubEnv('ANTHROPIC_API_KEY', '');
    await expect(call()).rejects.toThrow('ANTHROPIC_API_KEY');
    expect(calls.countTokens).not.toHaveBeenCalled();
    expect(calls.parse).not.toHaveBeenCalled();
  });
  it('validates output and settles measured token usage', async () => {
    const before = budgetStatus().used;
    await expect(call()).resolves.toEqual({ data: { answer: 'ok' }, cost: 0.002 });
    expect(budgetStatus().used - before).toBeCloseTo(0.002);
  });
  it('retains a conservative reservation after uncertain provider failure', async () => {
    const before = budgetStatus().used;
    calls.parse.mockRejectedValue(new Error('Do not expose provider internals.'));
    await expect(call()).rejects.toThrow('conservative reservation');
    expect(budgetStatus().used).toBeGreaterThan(before);
    expect(calls.parse).toHaveBeenCalledTimes(1);
  });
  it('handles authentication failure during preflight without a paid request', async () => {
    calls.countTokens.mockRejectedValue(new Anthropic.AuthenticationError(401, undefined, 'Invalid test key', new Headers()));
    await expect(call()).rejects.toThrow('authenticate');
    expect(calls.parse).not.toHaveBeenCalled();
  });
  it('explains an unscoped key without falsely claiming a budget reservation', async () => {
    const before = budgetStatus().used;
    calls.countTokens.mockRejectedValue(Object.assign(new Error('Provider rejected preflight.'), {
      status: 400,
      error: { error: { type: 'invalid_request_error', message: 'This API key is not scoped to a workspace; include the anthropic-workspace-id header.' } },
    }));
    await expect(call()).rejects.toThrow('workspace-scoped');
    await expect(call()).rejects.toThrow('No generation request was sent and no budget reservation was created');
    expect(calls.parse).not.toHaveBeenCalled();
    expect(budgetStatus().used).toBe(before);
  });
  it('releases only the reservation for a definitively rejected inference request', async () => {
    const before = budgetStatus().used;
    calls.parse.mockRejectedValue(Object.assign(new Error('Provider rejected generation.'), {
      status: 400,
      error: { error: { type: 'invalid_request_error', message: 'Your credit balance is too low to access the API.' } },
    }));
    await expect(call()).rejects.toThrow('API credit');
    expect(budgetStatus().used).toBe(before);
  });
  it('retries one transient 500, reserving the second attempt separately', async () => {
    vi.useFakeTimers();
    const before = budgetStatus().used;
    calls.parse.mockRejectedValueOnce(Object.assign(new Error('Temporary provider failure.'), { status: 500 }));
    const result = call();
    const assertion = expect(result).resolves.toMatchObject({ data: { answer: 'ok' }, cost: 0.002 });
    await Promise.all([assertion, vi.runAllTimersAsync()]);
    expect(calls.parse).toHaveBeenCalledTimes(2);
    expect(budgetStatus().used - before).toBeCloseTo(0.011 + 0.002);
  });
  it('stops after two transient failures and retains both uncertain reservations', async () => {
    vi.useFakeTimers();
    const before = budgetStatus().used;
    calls.parse.mockRejectedValue(Object.assign(new Error('Temporary provider failure.'), { status: 500 }));
    const assertion = expect(call()).rejects.toThrow('2 attempts');
    await Promise.all([assertion, vi.runAllTimersAsync()]);
    expect(calls.parse).toHaveBeenCalledTimes(2);
    expect(budgetStatus().used - before).toBeCloseTo(0.022);
  });
  it('will not retry a failed inference when another reservation would exceed the allowance', async () => {
    vi.useFakeTimers();
    vi.stubEnv('AUTOPOST_AI_LIMIT_USD', String(budgetStatus().used + 0.015));
    calls.parse.mockRejectedValue(Object.assign(new Error('Temporary provider failure.'), { status: 500 }));
    const assertion = expect(call()).rejects.toThrow('exhausted');
    await Promise.all([assertion, vi.runAllTimersAsync()]);
    expect(calls.parse).toHaveBeenCalledTimes(1);
  });
  it('does not retry schema failures or long provider retry delays', async () => {
    calls.parse.mockRejectedValue(Object.assign(new Error('Rate limited.'), { status: 429, headers: new Headers({ 'retry-after': '60' }) }));
    await expect(call()).rejects.toThrow('rate-limited');
    expect(calls.parse).toHaveBeenCalledTimes(1);
    calls.parse.mockReset().mockResolvedValue({ parsed_output: null, usage: { input_tokens: 1000, output_tokens: 200 } });
    await expect(call()).rejects.toThrow('complete proposal');
    expect(calls.parse).toHaveBeenCalledTimes(1);
  });
  it('rejects incomplete output rather than fabricating a result', async () => {
    calls.parse.mockResolvedValue({ parsed_output: null, usage: { input_tokens: 1000, output_tokens: 200 } });
    await expect(call()).rejects.toThrow('complete proposal');
  });
  it('stops before inference when the app allowance is exhausted', async () => {
    vi.stubEnv('AUTOPOST_AI_LIMIT_USD', String(budgetStatus().used + 0.001));
    await expect(call()).rejects.toThrow('exhausted');
    expect(calls.parse).not.toHaveBeenCalled();
  });
});
