import { createSign, generateKeyPairSync } from 'crypto';
import { SnsMessage, SnsSignatureVerifier, isTrustedSnsUrl, snsStringToSign } from './sns-message';

describe('SNS signatures', () => {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const pem = publicKey.export({ type: 'spki', format: 'pem' }).toString();
  const certUrl = 'https://sns.ap-south-1.amazonaws.com/SimpleNotificationService-abc.pem';

  function signed(overrides: Partial<SnsMessage> = {}): SnsMessage {
    const msg: SnsMessage = {
      Type: 'Notification',
      MessageId: 'id-1',
      TopicArn: 'arn:aws:sns:ap-south-1:123:alarms',
      Message: '{"AlarmName":"x"}',
      Timestamp: '2026-09-15T03:14:00.000Z',
      SignatureVersion: '2',
      Signature: '',
      SigningCertURL: certUrl,
      Subject: 'ALARM',
      ...overrides,
    };
    msg.Signature = createSign('RSA-SHA256')
      .update(snsStringToSign(msg))
      .sign(privateKey, 'base64');
    return msg;
  }

  it('accepts a correctly signed message and caches the cert', async () => {
    const fetchCert = jest.fn().mockResolvedValue(pem);
    const verifier = new SnsSignatureVerifier(fetchCert);
    expect(await verifier.verify(signed())).toBe(true);
    expect(await verifier.verify(signed({ MessageId: 'id-2' }))).toBe(true);
    expect(fetchCert).toHaveBeenCalledTimes(1);
  });

  it('rejects a tampered message', async () => {
    const verifier = new SnsSignatureVerifier(jest.fn().mockResolvedValue(pem));
    const msg = signed();
    msg.Message = '{"AlarmName":"forged"}';
    expect(await verifier.verify(msg)).toBe(false);
  });

  it('never fetches certs from non-AWS hosts', async () => {
    const fetchCert = jest.fn().mockResolvedValue(pem);
    const verifier = new SnsSignatureVerifier(fetchCert);
    expect(
      await verifier.verify(signed({ SigningCertURL: 'https://evil.example.com/cert.pem' })),
    ).toBe(false);
    expect(fetchCert).not.toHaveBeenCalled();
  });

  it('validates SNS URLs strictly', () => {
    expect(isTrustedSnsUrl('https://sns.us-east-1.amazonaws.com/?Action=ConfirmSubscription')).toBe(
      true,
    );
    expect(isTrustedSnsUrl('http://sns.us-east-1.amazonaws.com/')).toBe(false);
    expect(isTrustedSnsUrl('https://sns.us-east-1.amazonaws.com.evil.com/')).toBe(false);
    expect(isTrustedSnsUrl('https://169.254.169.254/latest/meta-data')).toBe(false);
    expect(isTrustedSnsUrl(null)).toBe(false);
  });
});
