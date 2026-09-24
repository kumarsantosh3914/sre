import { createHash, randomBytes, timingSafeEqual } from 'crypto';

const API_KEY_PREFIX = 'sreai_';
const DISPLAY_PREFIX_LENGTH = 14;

export interface GeneratedApiKey {
  // Shown to the user exactly once; never stored.
  plaintext: string;
  // SHA-256 hex digest — what the database stores and looks up by. API
  // keys are 256-bit random, so a fast digest is safe here (no dictionary
  // to brute-force), and it keeps the webhook hot path fast.
  hash: string;
  // Non-secret leading characters so users can tell keys apart in the UI.
  displayPrefix: string;
}

export function hashApiKey(plaintext: string): string {
  return createHash('sha256').update(plaintext).digest('hex');
}

export function generateApiKey(): GeneratedApiKey {
  const plaintext = `${API_KEY_PREFIX}${randomBytes(32).toString('base64url')}`;
  return {
    plaintext,
    hash: hashApiKey(plaintext),
    displayPrefix: plaintext.slice(0, DISPLAY_PREFIX_LENGTH),
  };
}

export function looksLikeApiKey(candidate: string): boolean {
  return candidate.startsWith(API_KEY_PREFIX) && candidate.length >= 40 && candidate.length <= 80;
}

export function constantTimeEquals(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

export function sha256Hex(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}
