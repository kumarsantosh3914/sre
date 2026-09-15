import { MigrationInterface, QueryRunner } from 'typeorm';

// Enables pgvector and adds the embedding column incidents will use for
// similar_incident search (text-embedding-3-small, 1536 dims — see
// CLAUDE.md's LLM & Embeddings section). Not yet mapped on the Incident
// entity — nothing reads/writes it until that search is built.
export class AddPgvectorExtension1789485653899 implements MigrationInterface {
  name = 'AddPgvectorExtension1789485653899';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS vector`);
    await queryRunner.query(`ALTER TABLE "incidents" ADD COLUMN "embedding" vector(1536)`);
    await queryRunner.query(`
      CREATE INDEX "idx_incidents_embedding" ON "incidents"
      USING hnsw ("embedding" vector_cosine_ops)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "idx_incidents_embedding"`);
    await queryRunner.query(`ALTER TABLE "incidents" DROP COLUMN "embedding"`);
    await queryRunner.query(`DROP EXTENSION IF EXISTS vector`);
  }
}
