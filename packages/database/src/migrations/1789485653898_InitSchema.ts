import { MigrationInterface, QueryRunner } from 'typeorm';

export class InitSchema1789485653898 implements MigrationInterface {
  name = 'InitSchema1789485653898';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "tenants" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "name" varchar NOT NULL UNIQUE,
        "slug" varchar NOT NULL UNIQUE,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now()
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "services" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
        "name" varchar NOT NULL,
        "always_escalate" boolean NOT NULL DEFAULT false,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        UNIQUE ("tenant_id", "name")
      )
    `);
    await queryRunner.query(`CREATE INDEX "idx_services_tenant_id" ON "services" ("tenant_id")`);

    await queryRunner.query(
      `CREATE TYPE "incident_severity_enum" AS ENUM ('p1', 'p2', 'p3')`,
    );
    await queryRunner.query(
      `CREATE TYPE "incident_status_enum" AS ENUM ('detecting', 'diagnosing', 'acting', 'resolved', 'escalated')`,
    );
    await queryRunner.query(`
      CREATE TABLE "incidents" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
        "service_id" uuid REFERENCES "services"("id") ON DELETE SET NULL,
        "severity" "incident_severity_enum" NOT NULL,
        "status" "incident_status_enum" NOT NULL DEFAULT 'detecting',
        "title" varchar NOT NULL,
        "description" text,
        "source_alert" jsonb NOT NULL,
        "detected_at" timestamptz NOT NULL,
        "resolved_at" timestamptz,
        "mttr_seconds" integer,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "idx_incidents_tenant_status" ON "incidents" ("tenant_id", "status")`,
    );

    await queryRunner.query(`CREATE TYPE "action_tier_enum" AS ENUM ('auto', 'draft', 'escalate')`);
    await queryRunner.query(`
      CREATE TABLE "diagnoses" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
        "incident_id" uuid NOT NULL REFERENCES "incidents"("id") ON DELETE CASCADE,
        "hypothesis" text NOT NULL,
        "confidence" float NOT NULL,
        "evidence" jsonb NOT NULL,
        "recommended_action" text NOT NULL,
        "action_tier" "action_tier_enum" NOT NULL,
        "reasoning" text NOT NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "idx_diagnoses_tenant_incident" ON "diagnoses" ("tenant_id", "incident_id")`,
    );

    await queryRunner.query(`
      CREATE TABLE "citation_failures" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
        "diagnosis_id" uuid NOT NULL REFERENCES "diagnoses"("id") ON DELETE CASCADE,
        "claim" text NOT NULL,
        "source" varchar NOT NULL,
        "reference" text NOT NULL,
        "failure_reason" text NOT NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "idx_citation_failures_tenant_diagnosis" ON "citation_failures" ("tenant_id", "diagnosis_id")`,
    );

    await queryRunner.query(
      `CREATE TYPE "action_status_enum" AS ENUM ('pending', 'approved', 'rejected', 'executed', 'failed', 'rolled_back')`,
    );
    await queryRunner.query(`
      CREATE TABLE "actions" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
        "incident_id" uuid NOT NULL REFERENCES "incidents"("id") ON DELETE CASCADE,
        "tier" "action_tier_enum" NOT NULL,
        "status" "action_status_enum" NOT NULL DEFAULT 'pending',
        "payload" jsonb NOT NULL,
        "audit_trail" jsonb NOT NULL DEFAULT '[]',
        "executed_at" timestamptz,
        "rolled_back_at" timestamptz,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "idx_actions_tenant_incident" ON "actions" ("tenant_id", "incident_id")`,
    );

    await queryRunner.query(`
      CREATE TABLE "integrations" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
        "type" varchar NOT NULL,
        "encrypted_credentials" text NOT NULL,
        "config" jsonb NOT NULL DEFAULT '{}',
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        UNIQUE ("tenant_id", "type")
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "integrations"`);
    await queryRunner.query(`DROP TABLE "actions"`);
    await queryRunner.query(`DROP TYPE "action_status_enum"`);
    await queryRunner.query(`DROP TABLE "citation_failures"`);
    await queryRunner.query(`DROP TABLE "diagnoses"`);
    await queryRunner.query(`DROP TYPE "action_tier_enum"`);
    await queryRunner.query(`DROP TABLE "incidents"`);
    await queryRunner.query(`DROP TYPE "incident_status_enum"`);
    await queryRunner.query(`DROP TYPE "incident_severity_enum"`);
    await queryRunner.query(`DROP TABLE "services"`);
    await queryRunner.query(`DROP TABLE "tenants"`);
  }
}
