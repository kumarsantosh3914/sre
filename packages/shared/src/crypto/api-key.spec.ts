import { constantTimeEquals, generateApiKey, hashApiKey, looksLikeApiKey } from './api-key';

describe('api keys', () => {
  it('generates a prefixed, high-entropy key whose hash is stable', () => {
    const key = generateApiKey();
    expect(key.plaintext.startsWith('sreai_')).toBe(true);
    expect(looksLikeApiKey(key.plaintext)).toBe(true);
    expect(key.hash).toBe(hashApiKey(key.plaintext));
    expect(key.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(key.plaintext.startsWith(key.displayPrefix)).toBe(true);
  });

  it('never generates the same key twice', () => {
    expect(generateApiKey().plaintext).not.toEqual(generateApiKey().plaintext);
  });

  it('rejects strings that are not API keys', () => {
    expect(looksLikeApiKey('not-a-key')).toBe(false);
    expect(looksLikeApiKey('sreai_short')).toBe(false);
  });

  it('compares in constant time', () => {
    expect(constantTimeEquals('abc', 'abc')).toBe(true);
    expect(constantTimeEquals('abc', 'abd')).toBe(false);
    expect(constantTimeEquals('abc', 'abcd')).toBe(false);
  });
});
