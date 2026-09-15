import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddUsers1789486694163 implements MigrationInterface {
  name = 'AddUsers1789486694163';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "user_role_enum" AS ENUM ('owner', 'admin', 'member')`,
    );
    await queryRunner.query(`
      CREATE TABLE "users" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
        "email" varchar NOT NULL UNIQUE,
        "password_hash" varchar NOT NULL,
        "role" "user_role_enum" NOT NULL DEFAULT 'member',
        "refresh_token_hash" varchar,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(`CREATE INDEX "idx_users_tenant_id" ON "users" ("tenant_id")`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "users"`);
    await queryRunner.query(`DROP TYPE "user_role_enum"`);
  }
}
