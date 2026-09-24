import { createHmac } from 'crypto';
import { constantTimeEquals } from '@sreai/shared';

// Sentry signs the raw request body with the integration's client secret:
// Sentry-Hook-Signature = hex(HMAC-SHA256(clientSecret, rawBody)).
export function verifySentrySignature(
  rawBody: Buffer | undefined,
  signature: string | undefined,
  clientSecret: string,
): boolean {
  if (!rawBody || !signature) return false;
  const expected = createHmac('sha256', clientSecret).update(rawBody).digest('hex');
  return constantTimeEquals(expected, signature);
}
