import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { z } from 'zod';
import { AppError } from '../db';
import { MODEL, reserveBudget, settleBudget, failBudget, rejectBudget } from './budget';
import { describeAIError, providerStatus } from './errors';

function transientRetryDelay(error: unknown): number | undefined {
  if (!error || typeof error !== 'object') return undefined;
  const failure = error as { name?: string; headers?: Headers };
  const status = providerStatus(error);
  if (!(status && [408, 429, 500, 502, 503, 504, 529].includes(status)) && !['APIConnectionError', 'APIConnectionTimeoutError'].includes(failure.name || '')) return undefined;
  const retryAfter = failure.headers?.get('retry-after');
  const requested = retryAfter ? (/^\d+(\.\d+)?$/.test(retryAfter) ? Number(retryAfter) * 1000 : Date.parse(retryAfter) - Date.now()) : 0;
  if (Number.isFinite(requested) && requested > 8000) return undefined;
  return Math.max(2000, Number.isFinite(requested) ? requested : 0);
}

export async function checkConnection() {
  if (!process.env.ANTHROPIC_API_KEY) throw new AppError('ANTHROPIC_API_KEY is not configured in the running server.', 401);
  try {
    const client = new Anthropic({ maxRetries: 0, timeout: 15000 });
    const result = await client.messages.countTokens({ model: MODEL, messages: [{ role: 'user', content: 'Connection check.' }] });
    return { connected: true, model: MODEL, inputTokens: result.input_tokens };
  } catch (error) {
    throw describeAIError(error, 'preflight', 'No generation request was sent and no budget reservation was created.', true);
  }
}

export async function structuredCall<T extends z.ZodType>(schema: T, system: string, content: Anthropic.ContentBlockParam[], maxTokens: number, runId: string) {
  if (!process.env.ANTHROPIC_API_KEY) throw new AppError('Set ANTHROPIC_API_KEY in .env or .env.local and restart the app. Never paste keys into chat.', 401);
  const client = new Anthropic({ maxRetries: 0, timeout: 120000 });
  const messages: Anthropic.MessageParam[] = [{ role: 'user', content }];
  let earlierUncertain = false;
  for (let attempt = 0; attempt < 2; attempt++) {
    let reservationId: string | undefined;
    let stage: 'preflight' | 'generation' | 'validation' = 'preflight';
    let settled = false;
    try {
      const format = zodOutputFormat(schema);
      const count = await client.messages.countTokens({ model: MODEL, system, messages });
      const reservation = (count.input_tokens + 5000 + maxTokens * 5) / 1_000_000;
      reservationId = reserveBudget(reservation, runId);
      stage = 'generation';
      const message = await client.messages.parse({ model: MODEL, system, messages, max_tokens: maxTokens, output_config: { format } });
      const cost = settleBudget(reservationId, message.usage.input_tokens, message.usage.output_tokens);
      settled = true;
      stage = 'validation';
      if (!message.parsed_output) throw new AppError('The model did not return a complete proposal. Your edits are unchanged; generation usage has been recorded.');
      return { data: schema.parse(message.parsed_output) as z.infer<T>, cost };
    } catch (error) {
      let accounting = 'No generation request was sent and no budget reservation was created for this attempt.';
      if (earlierUncertain) accounting += ' An earlier attempt’s conservative reservation remains held.';
      if (reservationId && !settled) {
        const status = providerStatus(error);
        if (status && [400, 401, 403, 404, 413, 422, 429].includes(status)) {
          rejectBudget(reservationId);
          accounting = 'The provider rejected this request; its local reservation was released.' + (earlierUncertain ? ' An earlier uncertain reservation remains held.' : '');
        } else {
          failBudget(reservationId);
          earlierUncertain = true;
          accounting = 'A conservative reservation is retained for each uncertain attempt; this is not confirmed spending.';
        }
      } else if (settled) accounting = 'Generation usage has been recorded; no additional reservation is retained for this attempt.';
      if (error instanceof AppError) throw error;
      const delay = !settled && stage !== 'validation' ? transientRetryDelay(error) : undefined;
      if (attempt === 0 && delay !== undefined) {
        await new Promise(resolve => setTimeout(resolve, delay));
        continue;
      }
      throw describeAIError(error, stage, `${accounting}${attempt ? ' Stopped after 2 attempts. Resume to process only unfinished photos.' : ''}`);
    }
  }
  throw new AppError('AI request stopped. Completed analyses remain cached.', 502);
}
