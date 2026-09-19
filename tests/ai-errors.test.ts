import { afterEach, expect, it, vi } from 'vitest';
import { describeAIError } from '../src/lib/server/ai/errors';

afterEach(() => vi.unstubAllEnvs());
it('only exposes provider text in an explicit text-only diagnostic, with credentials redacted', () => {
  const key = 'private-test-credential';
  vi.stubEnv('ANTHROPIC_API_KEY', key);
  const error = { status: 400, error: { error: { type: 'invalid_request_error', message: `Bad request: ${key}; sk-ant-testcredential; Bearer another-secret` } } };
  const normal = describeAIError(error, 'preflight', 'No reservation.');
  expect(normal.message).not.toContain('Bad request:');
  const diagnostic = describeAIError(error, 'preflight', 'No reservation.', true);
  expect(diagnostic.message).toContain('[redacted]');
  for (const secret of [key, 'sk-ant-testcredential', 'another-secret']) expect(diagnostic.message).not.toContain(secret);
});
it('does not expose unexpected local exception messages', () => {
  const error = describeAIError(new Error('Private request body must not be displayed.'), 'generation', 'Billing is uncertain.');
  expect(error.message).not.toContain('Private request body');
});
it('identifies workspace selection and TLS failures without bypassing safeguards', () => {
  const workspace = describeAIError({ status: 400, error: { error: { message: 'This API key is not scoped to a workspace.' } } }, 'preflight', 'No reservation.');
  expect(workspace.message).toContain('workspace-scoped');
  const tls = describeAIError({ cause: { cause: { code: 'UNABLE_TO_VERIFY_LEAF_SIGNATURE' } } }, 'preflight', 'No reservation.');
  expect(tls.message).toContain('certificate verification remains enabled');
});
