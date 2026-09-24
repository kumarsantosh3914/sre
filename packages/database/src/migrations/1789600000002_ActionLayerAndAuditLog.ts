import { MigrationInterface, QueryRunner } from 'typeorm';

// Phase 3 schema: typed action records (what was done, by whom, with what
// result, and what it rolled back) plus the append-only audit log.
export class ActionLayerAndAuditLog1789600000002 implements MigrationInterface {
  name = 'ActionLayerAndAuditLog1789600000002';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TYPE "action_status_enum" ADD VALUE IF NOT EXISTS 'expired'`);

    await queryRunner.query(`
      ALTER TABLE "actions"
        ADD COLUMN "action_type" varchar(30) NOT NULL DEFAULT 'notify',
        ADD COLUMN "description" text NOT NULL DEFAULT '',
        ADD COLUMN "result" jsonb,
        ADD COLUMN "error" text,
        ADD COLUMN "requested_by" varchar(128),
        ADD COLUMN "decided_by" varchar(128),
        ADD COLUMN "decided_at" timestamptz,
        ADD COLUMN "expires_at" timestamptz,
        ADD COLUMN "parent_action_id" uuid REFERENCES "actions"("id") ON DELETE CASCADE
    `);

    await queryRunner.query(`
      CREATE TABLE "audit_logs" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
        "incident_id" uuid REFERENCES "incidents"("id") ON DELETE CASCADE,
        "actor_type" varchar(16) NOT NULL,
        "actor_id" varchar(128),
        "event" varchar(64) NOT NULL,
        "before" jsonb,
        "after" jsonb,
        "metadata" jsonb NOT NULL DEFAULT '{}',
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "idx_audit_logs_tenant_incident" ON "audit_logs" ("tenant_id", "incident_id", "created_at")`,
    );

    // Append-only, enforced by the database rather than by convention.
    // Deletes are allowed only as a cascade from a tenant/incident delete
    // (pg_trigger_depth() > 1 means we're inside the FK's RI trigger).
    await queryRunner.query(`
      CREATE FUNCTION audit_logs_append_only() RETURNS trigger AS $$
      BEGIN
        IF TG_OP = 'UPDATE' THEN
          RAISE EXCEPTION 'audit_logs is append-only: UPDATE is not allowed';
        END IF;
        IF TG_OP = 'DELETE' AND pg_trigger_depth() <= 1 THEN
          RAISE EXCEPTION 'audit_logs is append-only: DELETE is not allowed';
        END IF;
        RETURN OLD;
      END;
      $$ LANGUAGE plpgsql
    `);
    await queryRunner.query(`
      CREATE TRIGGER "trg_audit_logs_append_only"
      BEFORE UPDATE OR DELETE ON "audit_logs"
      FOR EACH ROW EXECUTE FUNCTION audit_logs_append_only()
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TRIGGER "trg_audit_logs_append_only" ON "audit_logs"`);
    await queryRunner.query(`DROP FUNCTION audit_logs_append_only()`);
    await queryRunner.query(`DROP TABLE "audit_logs"`);

    await queryRunner.query(`
      ALTER TABLE "actions"
        DROP COLUMN "parent_action_id",
        DROP COLUMN "expires_at",
        DROP COLUMN "decided_at",
        DROP COLUMN "decided_by",
        DROP COLUMN "requested_by",
        DROP COLUMN "error",
        DROP COLUMN "result",
        DROP COLUMN "description",
        DROP COLUMN "action_type"
    `);

    // Postgres can't drop an enum value; rebuild the type without it.
    await queryRunner.query(
      `UPDATE "actions" SET "status" = 'rejected' WHERE "status" = 'expired'`,
    );
    await queryRunner.query(`ALTER TYPE "action_status_enum" RENAME TO "action_status_enum_old"`);
    await queryRunner.query(
      `CREATE TYPE "action_status_enum" AS ENUM ('pending', 'approved', 'rejected', 'executed', 'failed', 'rolled_back')`,
    );
    await queryRunner.query(`ALTER TABLE "actions" ALTER COLUMN "status" DROP DEFAULT`);
    await queryRunner.query(`
      ALTER TABLE "actions" ALTER COLUMN "status"
      TYPE "action_status_enum" USING "status"::text::"action_status_enum"
    `);
    await queryRunner.query(`ALTER TABLE "actions" ALTER COLUMN "status" SET DEFAULT 'pending'`);
    await queryRunner.query(`DROP TYPE "action_status_enum_old"`);
  }
}
