import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { errorMeta } from '@sreai/shared';

// Post-mortems are always stored in Postgres; S3 (S3_BUCKET_NAME) is an
// optional durable/downloadable copy. Upload failures never lose the
// post-mortem.
@Injectable()
export class PostmortemStorage {
  private readonly logger = new Logger(PostmortemStorage.name);
  private readonly bucket: string | undefined;
  private readonly client: S3Client | null;

  constructor(config: ConfigService) {
    this.bucket = config.get<string>('S3_BUCKET_NAME') || undefined;
    const endpoint = config.get<string>('S3_ENDPOINT') || undefined;
    this.client = this.bucket
      ? new S3Client({
          region: config.get<string>('AWS_REGION') ?? 'ap-south-1',
          ...(endpoint ? { endpoint, forcePathStyle: true } : {}),
        })
      : null;
  }

  async put(tenantId: string, incidentId: string, markdown: string): Promise<string | null> {
    if (!this.client || !this.bucket) return null;
    const key = `postmortems/${tenantId}/${incidentId}.md`;
    try {
      await this.client.send(
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: key,
          Body: markdown,
          ContentType: 'text/markdown; charset=utf-8',
          ServerSideEncryption: 'AES256',
        }),
      );
      return key;
    } catch (err) {
      this.logger.warn('Post-mortem upload to S3 failed', {
        tenantId,
        incidentId,
        ...errorMeta(err),
      });
      return null;
    }
  }
}
