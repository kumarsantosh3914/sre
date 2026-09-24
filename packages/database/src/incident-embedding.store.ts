import { LLM } from '@sreai/shared';
import { DataSource } from 'typeorm';

export interface SimilarIncidentRow {
  id: string;
  title: string;
  status: string;
  mttrSeconds: number | null;
  resolvedAt: Date | null;
  similarity: number;
}

function toVectorLiteral(embedding: number[]): string {
  if (embedding.length !== LLM.EMBEDDING_DIMENSIONS) {
    throw new Error(
      `Expected a ${LLM.EMBEDDING_DIMENSIONS}-dimension embedding, got ${embedding.length}`,
    );
  }
  if (!embedding.every((v) => Number.isFinite(v))) {
    throw new Error('Embedding contains non-finite values');
  }
  return `[${embedding.join(',')}]`;
}

// incidents.embedding is a pgvector column TypeORM can't map, so it's
// accessed only through here — every statement tenant-scoped (CLAUDE.md
// rule #3), all values parameterised.
export class IncidentEmbeddingStore {
  constructor(private readonly dataSource: DataSource) {}

  async setEmbedding(tenantId: string, incidentId: string, embedding: number[]): Promise<void> {
    await this.dataSource.query(
      `UPDATE "incidents" SET "embedding" = $1::vector WHERE "tenant_id" = $2 AND "id" = $3`,
      [toVectorLiteral(embedding), tenantId, incidentId],
    );
  }

  // Top-N resolved incidents by cosine similarity, above a threshold.
  async findSimilarResolved(
    tenantId: string,
    embedding: number[],
    excludeIncidentId: string,
    limit: number,
    minSimilarity: number,
  ): Promise<SimilarIncidentRow[]> {
    const rows: {
      id: string;
      title: string;
      status: string;
      mttr_seconds: number | null;
      resolved_at: Date | null;
      similarity: string | number;
    }[] = await this.dataSource.query(
      `SELECT "id", "title", "status", "mttr_seconds", "resolved_at",
              1 - ("embedding" <=> $1::vector) AS "similarity"
         FROM "incidents"
        WHERE "tenant_id" = $2
          AND "status" = 'resolved'
          AND "id" <> $3
          AND "embedding" IS NOT NULL
        ORDER BY "embedding" <=> $1::vector
        LIMIT $4`,
      [toVectorLiteral(embedding), tenantId, excludeIncidentId, limit],
    );
    return rows
      .map((r) => ({
        id: r.id,
        title: r.title,
        status: r.status,
        mttrSeconds: r.mttr_seconds,
        resolvedAt: r.resolved_at,
        similarity: Number(r.similarity),
      }))
      .filter((r) => r.similarity >= minSimilarity);
  }
}
