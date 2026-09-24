import { MigrationInterface, QueryRunner } from 'typeorm';

// Phase 2 schema: record everything needed to audit a diagnosis after the
// fact — the raw LLM score vs. the adjusted one, citation results, the
// exact context the model saw, and which similar incidents informed it.
export class ExtendDiagnoses1789600000001 implements MigrationInterface {
  name = 'ExtendDiagnoses1789600000001';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "diagnoses"
        ADD COLUMN "llm_confidence" float,
        ADD COLUMN "citation_failure_rate" float NOT NULL DEFAULT 0,
        ADD COLUMN "citations_passed" boolean NOT NULL DEFAULT true,
        ADD COLUMN "context_used" jsonb NOT NULL DEFAULT '{}',
        ADD COLUMN "similar_incident_ids" uuid[] NOT NULL DEFAULT '{}',
        ADD COLUMN "model" varchar(64),
        ADD COLUMN "prompt_version" varchar(32),
        ADD COLUMN "token_usage" jsonb,
        ADD COLUMN "latency_ms" integer
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "diagnoses"
        DROP COLUMN "latency_ms",
        DROP COLUMN "token_usage",
        DROP COLUMN "prompt_version",
        DROP COLUMN "model",
        DROP COLUMN "similar_incident_ids",
        DROP COLUMN "context_used",
        DROP COLUMN "citations_passed",
        DROP COLUMN "citation_failure_rate",
        DROP COLUMN "llm_confidence"
    `);
  }
}
