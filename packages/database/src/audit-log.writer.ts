import { AuditActorType } from '@sreai/shared';
import { EntityManager } from 'typeorm';
import { AuditLog } from './entities/audit-log.entity';

export interface AuditEntry {
  tenantId: string;
  incidentId: string | null;
  actorType: AuditActorType;
  actorId?: string | null;
  event: string;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
  metadata?: Record<string, unknown>;
}

// Takes an EntityManager so the audit row commits in the same transaction
// as the state change it describes — never one without the other.
export async function writeAuditLog(manager: EntityManager, entry: AuditEntry): Promise<void> {
  // save() rather than insert(): TypeORM's insert typing can't express
  // jsonb Record<string, unknown> columns. With no id set it's a plain INSERT.
  await manager.save(
    AuditLog,
    manager.create(AuditLog, {
      tenantId: entry.tenantId,
      incidentId: entry.incidentId,
      actorType: entry.actorType,
      actorId: entry.actorId ?? null,
      event: entry.event,
      before: entry.before ?? null,
      after: entry.after ?? null,
      metadata: entry.metadata ?? {},
    }),
  );
}
