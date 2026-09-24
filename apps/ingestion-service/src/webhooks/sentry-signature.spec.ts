import { createHmac } from 'crypto';
import { verifySentrySignature } from './sentry-signature';

describe('verifySentrySignature', () => {
  const body = Buffer.from('{"action":"created"}');
  const secret = 'shh';
  const good = createHmac('sha256', secret).update(body).digest('hex');

  it('accepts the right signature and rejects anything else', () => {
    expect(verifySentrySignature(body, good, secret)).toBe(true);
    expect(verifySentrySignature(body, good.replace(/.$/, '0'), secret)).toBe(false);
    expect(verifySentrySignature(body, undefined, secret)).toBe(false);
    expect(verifySentrySignature(undefined, good, secret)).toBe(false);
  });
});
