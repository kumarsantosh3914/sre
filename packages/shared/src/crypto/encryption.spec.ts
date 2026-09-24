import { randomBytes } from 'crypto';
import {
  decryptJson,
  decryptString,
  encryptJson,
  encryptString,
  parseEncryptionKey,
} from './encryption';

describe('encryption', () => {
  const key = randomBytes(32);

  it('round-trips a string', () => {
    const payload = encryptString('xoxb-secret-token', key);
    expect(payload.startsWith('v1:')).toBe(true);
    expect(payload).not.toContain('xoxb-secret-token');
    expect(decryptString(payload, key)).toBe('xoxb-secret-token');
  });

  it('uses a fresh IV per encryption', () => {
    expect(encryptString('same', key)).not.toEqual(encryptString('same', key));
  });

  it('round-trips JSON credentials', () => {
    const creds = { accessKeyId: 'AKIA', secretAccessKey: 'shh' };
    expect(decryptJson(encryptJson(creds, key), key)).toEqual(creds);
  });

  it('rejects a tampered ciphertext', () => {
    const payload = encryptString('secret', key);
    const parts = payload.split(':');
    const data = Buffer.from(parts[3], 'base64');
    data[0] ^= 0xff;
    parts[3] = data.toString('base64');
    expect(() => decryptString(parts.join(':'), key)).toThrow();
  });

  it('rejects the wrong key', () => {
    const payload = encryptString('secret', key);
    expect(() => decryptString(payload, randomBytes(32))).toThrow();
  });

  it('validates the ENCRYPTION_KEY format', () => {
    expect(() => parseEncryptionKey(undefined)).toThrow();
    expect(() => parseEncryptionKey('abc')).toThrow();
    expect(parseEncryptionKey('a'.repeat(64))).toHaveLength(32);
  });
});
