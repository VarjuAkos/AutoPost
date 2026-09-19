import { AppError } from '../db';

type Failure = { status?: number; error?: { error?: { type?: string; message?: string }; type?: string; message?: string }; cause?: { code?: string; cause?: { code?: string } }; message?: string; name?: string };

export function providerStatus(error: unknown): number | undefined {
  if (!error || typeof error !== 'object') return undefined;
  const status = (error as Failure).status;
  return typeof status === 'number' && status >= 400 && status <= 599 ? status : undefined;
}
export function describeAIError(error: unknown, stage: 'preflight' | 'generation' | 'validation', accounting: string, textOnlyDiagnostic = false) {
  const failure = error && typeof error === 'object' ? error as Failure : {};
  const status = providerStatus(error);
  const detail = failure.error?.error || failure.error;
  const message = detail?.message || failure.message || '';
  const code = failure.cause?.cause?.code || failure.cause?.code;
  let reason: string;
  if (/not scoped to a workspace|anthropic-workspace-id/i.test(message)) reason = 'This key needs workspace selection. Use a workspace-scoped API key for the workspace containing your credit, update ANTHROPIC_API_KEY in .env, and restart the app.';
  else if (/credit balance|insufficient.*credit|billing|purchase.*credit/i.test(message)) reason = 'Anthropic reports insufficient API credit. Check billing for the API workspace that owns this key; a Claude subscription does not fund API usage.';
  else if (status === 401 || /authentication|invalid.*api.?key/i.test(message)) reason = 'Anthropic could not authenticate. Check ANTHROPIC_API_KEY in your local environment and restart the app.';
  else if (status === 403) reason = 'Anthropic denied access for this API workspace. Check the key’s permissions and account status.';
  else if (status === 404 || /model.*(not found|not supported|not available|does not exist)/i.test(message)) reason = 'Anthropic could not access the configured AI model. Check model availability for this API workspace.';
  else if (status === 429) reason = 'Anthropic rate-limited this request. Wait before trying again; completed analyses remain cached.';
  else if (code && /CERT|TLS|SSL|SELF_SIGNED|UNABLE_TO_VERIFY/.test(code)) reason = 'The server could not establish a trusted TLS connection to Anthropic. Check your local proxy or certificate configuration; certificate verification remains enabled.';
  else if (/countTokens.*not a function/i.test(message)) reason = 'The installed Anthropic SDK does not expose the token-count operation expected by this app.';
  else if (/compiled grammar.{0,80}too large|schema.{0,80}too complex/i.test(message)) reason = 'Anthropic rejected the request because the structured-output schema is too complex to compile. This is an app request-format issue, not a problem with your photos. Your cached analyses are kept; repeating the same request will not fix it.';
  else if (/output_config|output_format|json_schema|structured output/i.test(message)) reason = 'Anthropic rejected the structured-output configuration. The app’s request format needs to be checked.';
  else if (status === 400 || status === 422) reason = 'Anthropic rejected the request format. The app’s model and request parameters need to be checked.';
  else if (status === 413) reason = 'Anthropic rejected the request size. Try fewer photos.';
  else if (status && status >= 500) reason = 'Anthropic returned a service error. Retry later; your edits are unchanged.';
  else if (failure.name === 'APIConnectionError' || failure.name === 'APIConnectionTimeoutError' || /connection error|fetch failed|timed out/i.test(message)) reason = 'The app could not connect to Anthropic. Check network connectivity or proxy settings.';
  else reason = 'The AI client failed locally. No provider-specific reason is available; the SDK and response handling need to be checked.';
  const type = detail?.type && /^[a-z_]{1,60}$/.test(detail.type) ? `, ${detail.type}` : '';
  const location = stage === 'preflight' ? 'AI token-count check' : stage === 'generation' ? 'AI generation' : 'AI response validation';
  let diagnostic = '';
  if (textOnlyDiagnostic && typeof detail?.message === 'string') {
    const key = process.env.ANTHROPIC_API_KEY;
    const redacted = (key ? detail.message.split(key).join('[redacted]') : detail.message)
      .replace(/\bsk-[a-zA-Z0-9_-]+/g, '[redacted]')
      .replace(/Bearer\s+\S+/gi, 'Bearer [redacted]')
      .replace(/[a-zA-Z0-9+/=_-]{80,}/g, '[redacted]')
      .replace(/[\r\n\t]/g, ' ').slice(0, 500);
    diagnostic = ` Provider detail: ${redacted}`;
  }
  return new AppError(`${location} failed${status ? ` (HTTP ${status}${type})` : ''}. ${reason} ${accounting}${diagnostic}`, status === 401 || status === 403 || status === 429 ? status : 502);
}
