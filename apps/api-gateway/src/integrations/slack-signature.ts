import { createHmac } from 'crypto';
import { constantTimeEquals } from '@sreai/shared';

const MAX_SKEW_SECONDS = 5 * 60;

// Slack request signing: v0=HMAC-SHA256(signingSecret, "v0:<ts>:<raw body>"),
// rejecting stale timestamps to stop replays.
export function verifySlackSignature(
  signingSecret: string,
  rawBody: Buffer | undefined,
  timestamp: string | undefined,
  signature: string | undefined,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): boolean {
  if (!rawBody || !timestamp || !signature) return false;
  const ts = Number(timestamp);
  if (!Number.isInteger(ts) || Math.abs(nowSeconds - ts) > MAX_SKEW_SECONDS) return false;
  const expected = `v0=${createHmac('sha256', signingSecret).update(`v0:${timestamp}:`).update(rawBody).digest('hex')}`;
  return constantTimeEquals(expected, signature);
}
