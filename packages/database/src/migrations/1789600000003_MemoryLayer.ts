import { MigrationInterface, QueryRunner } from 'typeorm';

// Phase 4 schema: post-mortems, learned resolution patterns, and the
// runbooks generated from them.
export class MemoryLayer1789600000003 implements MigrationInterface {
  name = 'MemoryLayer1789600000003';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "postmortems" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
        "incident_id" uuid NOT NULL REFERENCES "incidents"("id") ON DELETE CASCADE,
        "markdown" text NOT NULL,
        "prevention" jsonb NOT NULL DEFAULT '[]',
        "storage_key" varchar(512),
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        UNIQUE ("tenant_id", "incident_id")
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "resolution_patterns" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
        "service_id" uuid REFERENCES "services"("id") ON DELETE SET NULL,
        "signature" varchar(64) NOT NULL,
        "alert_title" varchar(500) NOT NULL,
        "action_type" varchar(30) NOT NULL,
        "root_cause" text NOT NULL,
        "occurrences" integer NOT NULL DEFAULT 0,
        "successes" integer NOT NULL DEFAULT 0,
        "incident_ids" uuid[] NOT NULL DEFAULT '{}',
        "last_seen_at" timestamptz NOT NULL DEFAULT now(),
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        UNIQUE ("tenant_id", "signature", "action_type")
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "runbooks" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
        "service_id" uuid REFERENCES "services"("id") ON DELETE SET NULL,
        "signature" varchar(64) NOT NULL,
        "title" varchar(500) NOT NULL,
        "markdown" text NOT NULL,
        "incident_ids" uuid[] NOT NULL DEFAULT '{}',
        "version" integer NOT NULL DEFAULT 1,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        UNIQUE ("tenant_id", "signature")
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "runbooks"`);
    await queryRunner.query(`DROP TABLE "resolution_patterns"`);
    await queryRunner.query(`DROP TABLE "postmortems"`);
  }
}
