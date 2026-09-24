import { createHmac } from 'crypto';
import { verifySlackSignature } from './slack-signature';

describe('verifySlackSignature', () => {
  const secret = 'shh';
  const body = Buffer.from('payload=%7B%7D');
  const now = 1_790_000_000;
  const sign = (ts: number) =>
    `v0=${createHmac('sha256', secret).update(`v0:${ts}:${body}`).digest('hex')}`;

  it('accepts a fresh, correctly signed request', () => {
    expect(verifySlackSignature(secret, body, String(now), sign(now), now)).toBe(true);
  });

  it('rejects replays older than 5 minutes, bad signatures and missing parts', () => {
    expect(verifySlackSignature(secret, body, String(now - 301), sign(now - 301), now)).toBe(false);
    expect(verifySlackSignature(secret, body, String(now), 'v0=deadbeef', now)).toBe(false);
    expect(verifySlackSignature(secret, undefined, String(now), sign(now), now)).toBe(false);
    expect(verifySlackSignature(secret, body, 'not-a-number', sign(now), now)).toBe(false);
  });
});
