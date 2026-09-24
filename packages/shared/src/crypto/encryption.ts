import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12;
const KEY_BYTES = 32;
const VERSION = 'v1';

// Integration credentials (API tokens, AWS keys, webhook secrets) are
// encrypted at rest with AES-256-GCM under ENCRYPTION_KEY. GCM authenticates
// the ciphertext, so a tampered row fails to decrypt instead of yielding
// garbage credentials.
//
// Format: v1:<iv b64>:<auth tag b64>:<ciphertext b64>

export function parseEncryptionKey(hexKey: string | undefined): Buffer {
  if (!hexKey || !/^[0-9a-fA-F]{64}$/.test(hexKey)) {
    throw new Error('ENCRYPTION_KEY must be 32 bytes encoded as 64 hex characters');
  }
  return Buffer.from(hexKey, 'hex');
}

export function encryptString(plaintext: string, key: Buffer): string {
  if (key.length !== KEY_BYTES) {
    throw new Error('Encryption key must be 32 bytes');
  }
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [
    VERSION,
    iv.toString('base64'),
    tag.toString('base64'),
    ciphertext.toString('base64'),
  ].join(':');
}

export function decryptString(payload: string, key: Buffer): string {
  const parts = payload.split(':');
  if (parts.length !== 4 || parts[0] !== VERSION) {
    throw new Error('Unrecognised encrypted payload format');
  }
  const [, ivB64, tagB64, dataB64] = parts;
  const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(ivB64, 'base64'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(dataB64, 'base64')),
    decipher.final(),
  ]);
  return plaintext.toString('utf8');
}

export function encryptJson(value: Record<string, unknown>, key: Buffer): string {
  return encryptString(JSON.stringify(value), key);
}

export function decryptJson<T extends Record<string, unknown>>(payload: string, key: Buffer): T {
  return JSON.parse(decryptString(payload, key)) as T;
}
