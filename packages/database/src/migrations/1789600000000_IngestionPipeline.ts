import { MigrationInterface, QueryRunner } from 'typeorm';

// Phase 1 schema: hashed webhook API keys, the columns ingestion needs to
// dedupe/group/resolve incidents, and per-service + per-tenant settings.
export class IngestionPipeline1789600000000 implements MigrationInterface {
  name = 'IngestionPipeline1789600000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "api_keys" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
        "name" varchar(100) NOT NULL,
        "display_prefix" varchar(32) NOT NULL,
        "key_hash" varchar(64) NOT NULL UNIQUE,
        "last_used_at" timestamptz,
        "expires_at" timestamptz,
        "revoked_at" timestamptz,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(`CREATE INDEX "idx_api_keys_tenant_id" ON "api_keys" ("tenant_id")`);

    await queryRunner.query(`
      ALTER TABLE "incidents"
        ADD COLUMN "alert_source" varchar(30) NOT NULL DEFAULT 'generic',
        ADD COLUMN "fingerprint" varchar(64),
        ADD COLUMN "ingest_key" varchar(128),
        ADD COLUMN "labels" jsonb NOT NULL DEFAULT '{}',
        ADD COLUMN "enrichment" jsonb NOT NULL DEFAULT '{}',
        ADD COLUMN "alert_count" integer NOT NULL DEFAULT 1,
        ADD COLUMN "last_alert_at" timestamptz,
        ADD COLUMN "parent_incident_id" uuid REFERENCES "incidents"("id") ON DELETE SET NULL,
        ADD COLUMN "resolved_by" uuid,
        ADD COLUMN "resolution_note" text
    `);
    // Idempotent incident creation: one incident per ingest key per tenant,
    // no matter how many times SQS redelivers the message.
    await queryRunner.query(`
      CREATE UNIQUE INDEX "uq_incidents_tenant_ingest_key" ON "incidents" ("tenant_id", "ingest_key")
      WHERE "ingest_key" IS NOT NULL
    `);
    await queryRunner.query(
      `CREATE INDEX "idx_incidents_tenant_fingerprint" ON "incidents" ("tenant_id", "fingerprint")`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_incidents_tenant_detected_at" ON "incidents" ("tenant_id", "detected_at" DESC)`,
    );

    await queryRunner.query(`
      ALTER TABLE "services"
        ADD COLUMN "auto_execute_enabled" boolean NOT NULL DEFAULT false,
        ADD COLUMN "metadata" jsonb NOT NULL DEFAULT '{}'
    `);

    await queryRunner.query(
      `ALTER TABLE "tenants" ADD COLUMN "settings" jsonb NOT NULL DEFAULT '{}'`,
    );

    await queryRunner.query(`
      ALTER TABLE "integrations"
        ADD COLUMN "active" boolean NOT NULL DEFAULT true,
        ADD COLUMN "last_tested_at" timestamptz,
        ADD COLUMN "last_error" text
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "integrations"
        DROP COLUMN "last_error",
        DROP COLUMN "last_tested_at",
        DROP COLUMN "active"
    `);
    await queryRunner.query(`ALTER TABLE "tenants" DROP COLUMN "settings"`);
    await queryRunner.query(`
      ALTER TABLE "services"
        DROP COLUMN "metadata",
        DROP COLUMN "auto_execute_enabled"
    `);
    await queryRunner.query(`DROP INDEX "idx_incidents_tenant_detected_at"`);
    await queryRunner.query(`DROP INDEX "idx_incidents_tenant_fingerprint"`);
    await queryRunner.query(`DROP INDEX "uq_incidents_tenant_ingest_key"`);
    await queryRunner.query(`
      ALTER TABLE "incidents"
        DROP COLUMN "resolution_note",
        DROP COLUMN "resolved_by",
        DROP COLUMN "parent_incident_id",
        DROP COLUMN "last_alert_at",
        DROP COLUMN "alert_count",
        DROP COLUMN "enrichment",
        DROP COLUMN "labels",
        DROP COLUMN "ingest_key",
        DROP COLUMN "fingerprint",
        DROP COLUMN "alert_source"
    `);
    await queryRunner.query(`DROP TABLE "api_keys"`);
  }
}
