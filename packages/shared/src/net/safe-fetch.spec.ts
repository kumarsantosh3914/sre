import { BlockedAddressError, isBlockedAddress, safeFetch } from './safe-fetch';

describe('safeFetch', () => {
  it('classifies addresses', () => {
    for (const ip of [
      '127.0.0.1',
      '10.1.2.3',
      '169.254.169.254',
      '192.168.0.10',
      '172.20.0.1',
      '::1',
      'fd00::1',
      '::ffff:127.0.0.1',
    ]) {
      expect(isBlockedAddress(ip)).toBe(true);
    }
    for (const ip of ['8.8.8.8', '1.1.1.1', '2606:4700:4700::1111']) {
      expect(isBlockedAddress(ip)).toBe(false);
    }
  });

  it('refuses literal private and metadata addresses', async () => {
    await expect(
      safeFetch('http://169.254.169.254/latest/meta-data', { timeoutMs: 1000 }),
    ).rejects.toThrow(BlockedAddressError);
    await expect(safeFetch('http://[::1]:8080/', { timeoutMs: 1000 })).rejects.toThrow(
      BlockedAddressError,
    );
  });

  it('refuses hostnames that resolve to private addresses', async () => {
    const err: unknown = await safeFetch('http://localhost:8080/health', { timeoutMs: 1000 }).catch(
      (e: unknown) => e,
    );
    // undici wraps connect errors: the guard's error is the cause, not a
    // plain ECONNREFUSED from actually reaching localhost.
    expect((err as { cause?: unknown }).cause).toBeInstanceOf(BlockedAddressError);
  });

  it('refuses non-http schemes', async () => {
    await expect(safeFetch('file:///etc/passwd', { timeoutMs: 1000 })).rejects.toThrow(/scheme/);
  });
});
