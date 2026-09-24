import { createVerify } from 'crypto';
import { z } from 'zod';

export const SnsMessageSchema = z.object({
  Type: z.enum(['Notification', 'SubscriptionConfirmation', 'UnsubscribeConfirmation']),
  MessageId: z.string(),
  TopicArn: z.string(),
  Message: z.string(),
  Timestamp: z.string(),
  SignatureVersion: z.enum(['1', '2']),
  Signature: z.string(),
  SigningCertURL: z.string(),
  Subject: z.string().nullish(),
  SubscribeURL: z.string().nullish(),
  Token: z.string().nullish(),
});

export type SnsMessage = z.infer<typeof SnsMessageSchema>;

// Only AWS's own SNS endpoints may serve signing certs or subscription
// URLs — anything else would let a caller make us fetch arbitrary URLs
// (SSRF) or trust a self-signed "SNS" message.
const SNS_HOST = /^sns\.[a-z0-9-]+\.amazonaws\.com(\.cn)?$/;

export function isTrustedSnsUrl(raw: string | null | undefined, pathSuffix?: string): boolean {
  if (!raw) return false;
  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:' || !SNS_HOST.test(url.hostname) || url.port !== '') return false;
    return pathSuffix ? url.pathname.endsWith(pathSuffix) : true;
  } catch {
    return false;
  }
}

// Canonical string-to-sign per the SNS signature spec.
export function snsStringToSign(msg: SnsMessage): string {
  const keys =
    msg.Type === 'Notification'
      ? (['Message', 'MessageId', 'Subject', 'Timestamp', 'TopicArn', 'Type'] as const)
      : ([
          'Message',
          'MessageId',
          'SubscribeURL',
          'Timestamp',
          'Token',
          'TopicArn',
          'Type',
        ] as const);
  let out = '';
  for (const key of keys) {
    const value = msg[key];
    if (value === undefined || value === null) continue;
    out += `${key}\n${value}\n`;
  }
  return out;
}

export type CertFetcher = (url: string) => Promise<string>;

export const defaultCertFetcher: CertFetcher = async (url) => {
  const res = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(5_000) });
  if (!res.ok) throw new Error(`Failed to fetch SNS signing cert: HTTP ${res.status}`);
  return res.text();
};

export class SnsSignatureVerifier {
  private readonly certCache = new Map<string, string>();

  constructor(private readonly fetchCert: CertFetcher = defaultCertFetcher) {}

  async verify(msg: SnsMessage): Promise<boolean> {
    if (!isTrustedSnsUrl(msg.SigningCertURL, '.pem')) return false;
    let cert = this.certCache.get(msg.SigningCertURL);
    if (!cert) {
      cert = await this.fetchCert(msg.SigningCertURL);
      this.certCache.set(msg.SigningCertURL, cert);
    }
    const algorithm = msg.SignatureVersion === '2' ? 'RSA-SHA256' : 'RSA-SHA1';
    try {
      return createVerify(algorithm)
        .update(snsStringToSign(msg), 'utf8')
        .verify(cert, msg.Signature, 'base64');
    } catch {
      return false;
    }
  }
}
