import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { Action, Diagnosis, IncidentEmbeddingStore, ResolutionPattern } from '@sreai/database';
import { ActionStatus, SIMILAR_INCIDENT_LIMIT, SIMILARITY_THRESHOLD } from '@sreai/shared';
import { DataSource, In } from 'typeorm';
import { EmbeddingService } from '../../llm/embedding.service';
import {
  Collector,
  CollectorInput,
  CollectorResult,
  PatternMatch,
  SimilarIncidentSummary,
  emptySection,
} from '../context.types';
import { sanitizeLine } from '../sanitize';

export interface SimilarExtra {
  similarIncidents: SimilarIncidentSummary[];
  pattern: PatternMatch | null;
}

// Institutional memory: "this happened before, and X fixed it". Embeds
// the current incident (stored for future searches too), finds the top-3
// resolved look-alikes for this tenant above 0.75 similarity, and checks
// for a learned resolution pattern with the same signature.
@Injectable()
export class SimilarIncidentCollector implements Collector<SimilarExtra> {
  readonly source = 'similar_incident' as const;
  private readonly store: IncidentEmbeddingStore;

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly embeddings: EmbeddingService,
  ) {
    this.store = new IncidentEmbeddingStore(dataSource);
  }

  async collect(input: CollectorInput): Promise<CollectorResult<SimilarExtra>> {
    const { incident } = input;
    const embedding = await this.embeddings.embedIncident(incident);
    await this.store.setEmbedding(incident.tenantId, incident.id, embedding);

    const [rows, pattern] = await Promise.all([
      this.store.findSimilarResolved(
        incident.tenantId,
        embedding,
        incident.id,
        SIMILAR_INCIDENT_LIMIT,
        SIMILARITY_THRESHOLD,
      ),
      this.findPattern(incident.tenantId, incident.fingerprint),
    ]);

    const ids = rows.map((r) => r.id);
    const [diagnoses, actions] = ids.length
      ? await Promise.all([
          this.dataSource.getRepository(Diagnosis).find({
            where: { tenantId: incident.tenantId, incidentId: In(ids) },
            order: { createdAt: 'DESC' },
          }),
          this.dataSource.getRepository(Action).find({
            where: {
              tenantId: incident.tenantId,
              incidentId: In(ids),
              status: ActionStatus.EXECUTED,
            },
            order: { executedAt: 'DESC' },
          }),
        ])
      : [[], []];

    const similarIncidents: SimilarIncidentSummary[] = rows.map((r) => ({
      incidentId: r.id,
      title: r.title,
      similarity: Math.round(r.similarity * 100) / 100,
      mttrSeconds: r.mttrSeconds,
      rootCause: diagnoses.find((d) => d.incidentId === r.id)?.hypothesis ?? null,
      actionTaken: actions.find((a) => a.incidentId === r.id)?.description ?? null,
    }));

    const lines = similarIncidents.map((s) =>
      sanitizeLine(
        `past incident ${s.incidentId.slice(0, 8)} "${s.title}" (similarity ${s.similarity}, ` +
          `resolved in ${s.mttrSeconds ?? '?'}s): root cause: ${s.rootCause ?? 'not recorded'}; ` +
          `resolved by: ${s.actionTaken ?? 'no automated action'}`,
        800,
      ),
    );
    if (pattern) {
      lines.push(
        sanitizeLine(
          `known resolution pattern for this alert: ${pattern.actionType} resolved it ` +
            `${pattern.successes} of ${pattern.occurrences} times`,
        ),
      );
    }

    if (lines.length === 0) {
      return {
        section: emptySection('similar_incident', 'empty', 'no similar resolved incidents'),
        extra: { similarIncidents: [], pattern: null },
      };
    }
    return {
      section: { source: 'similar_incident', status: 'ok', lines },
      extra: { similarIncidents, pattern },
    };
  }

  private async findPattern(
    tenantId: string,
    signature: string | null,
  ): Promise<PatternMatch | null> {
    if (!signature) return null;
    const row = await this.dataSource.getRepository(ResolutionPattern).findOne({
      where: { tenantId, signature },
      order: { successes: 'DESC', occurrences: 'DESC' },
    });
    return row
      ? { actionType: row.actionType, occurrences: row.occurrences, successes: row.successes }
      : null;
  }
}
