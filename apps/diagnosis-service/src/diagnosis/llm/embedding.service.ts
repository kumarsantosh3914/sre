import { Injectable } from '@nestjs/common';
import { IncidentSnapshot } from '../context/context.types';
import { OpenAiClient } from './openai.client';

// Labels that differ between occurrences of the "same" incident and would
// only add noise to similarity.
const VOLATILE_LABELS = new Set([
  'instance',
  'pod',
  'pod_name',
  'container_id',
  'fingerprint',
  'sentry_issue',
  'endpoint',
  'uid',
]);

// Compact, stable text for an incident: service + alert + stable labels.
// Used both when storing an incident's embedding and when searching, so
// the two sides of a similarity comparison are built the same way.
export function incidentEmbeddingText(incident: IncidentSnapshot): string {
  const labels = Object.entries(incident.labels)
    .filter(([k]) => !VOLATILE_LABELS.has(k))
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(0, 20)
    .map(([k, v]) => `${k}=${v}`)
    .join(', ');
  return [
    `service: ${incident.serviceName}`,
    `alert: ${incident.title}`,
    labels ? `labels: ${labels}` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

@Injectable()
export class EmbeddingService {
  constructor(private readonly openai: OpenAiClient) {}

  embedIncident(incident: IncidentSnapshot): Promise<number[]> {
    return this.openai.embed(incidentEmbeddingText(incident));
  }
}
