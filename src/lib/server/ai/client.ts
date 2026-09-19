import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { z } from 'zod';
import { AppError } from '../db';
import { MODEL, reserveBudget, settleBudget, failBudget } from './budget';

export async function structuredCall<T extends z.ZodType>(schema: T, system: string, content: Anthropic.ContentBlockParam[], maxTokens: number) {
  if (!process.env.ANTHROPIC_API_KEY) throw new AppError('Add ANTHROPIC_API_KEY to .env.local and restart the app. Never paste keys into chat.', 401);
  const client = new Anthropic({ maxRetries: 0, timeout: 120000 });
  const messages: Anthropic.MessageParam[] = [{ role: 'user', content }];
  const format = zodOutputFormat(schema);
  const count = await client.messages.countTokens({ model: MODEL, system, messages });
  const reservation = (count.input_tokens + 5000 + maxTokens * 5) / 1_000_000;
  const id = reserveBudget(reservation);
  try {
    const message = await client.messages.parse({ model: MODEL, system, messages, max_tokens: maxTokens, output_config: { format } });
    const cost = settleBudget(id, message.usage.input_tokens, message.usage.output_tokens);
    if (!message.parsed_output) throw new AppError('The model did not return a complete proposal. Your edits are unchanged.');
    return { data: schema.parse(message.parsed_output) as z.infer<T>, cost };
  } catch (error) {
    failBudget(id);
    if (error instanceof AppError) throw error;
    if (error instanceof Anthropic.AuthenticationError) throw new AppError('Anthropic could not authenticate. Check your API key locally.', 401);
    if (error instanceof Anthropic.RateLimitError) throw new AppError('Anthropic rate-limited this request. Nothing was overwritten; retry later.', 429);
    throw new AppError('AI request failed. Your photos and edits are safe. A conservative reservation is retained if billing is uncertain.', 502);
  }
}
