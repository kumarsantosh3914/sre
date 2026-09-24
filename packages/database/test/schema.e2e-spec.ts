import { AuditActorType, IncidentSeverity, LLM } from '@sreai/shared';
import { DataSource } from 'typeorm';
import { IncidentEmbeddingStore } from '../src/incident-embedding.store';
import { writeAuditLog } from '../src/audit-log.writer';
import { Incident, Tenant } from '../src/entities';
import { createTestDatabase, TestDatabase } from '../src/testing';

function unitVector(hot: number): number[] {
  const v = new Array<number>(LLM.EMBEDDING_DIMENSIONS).fill(0);
  v[hot] = 1;
  return v;
}

describe('database schema (real PostgreSQL)', () => {
  let db: TestDatabase;
  let ds: DataSource;
  let tenantA: Tenant;
  let tenantB: Tenant;

  beforeAll(async () => {
    db = await createTestDatabase();
    ds = new DataSource(db.options);
    await ds.initialize();
    tenantA = await ds.getRepository(Tenant).save({ name: 'A', slug: 'a', settings: {} });
    tenantB = await ds.getRepository(Tenant).save({ name: 'B', slug: 'b', settings: {} });
  });

  afterAll(async () => {
    await ds?.destroy();
    await db?.destroy();
  });

  async function incident(tenantId: string, title: string): Promise<Incident> {
    return ds.getRepository(Incident).save({
      tenantId,
      severity: IncidentSeverity.P2,
      title,
      sourceAlert: {},
      detectedAt: new Date(),
    });
  }

  it('makes audit_logs append-only but still cascades tenant deletes', async () => {
    const inc = await incident(tenantA.id, 'audit test');
    await writeAuditLog(ds.manager, {
      tenantId: tenantA.id,
      incidentId: inc.id,
      actorType: AuditActorType.SYSTEM,
      event: 'incident.created',
    });

    await expect(ds.query(`UPDATE audit_logs SET event = 'x'`)).rejects.toThrow(/append-only/);
    await expect(ds.query(`DELETE FROM audit_logs`)).rejects.toThrow(/append-only/);

    const throwaway = await ds.getRepository(Tenant).save({ name: 'C', slug: 'c', settings: {} });
    await writeAuditLog(ds.manager, {
      tenantId: throwaway.id,
      incidentId: null,
      actorType: AuditActorType.SYSTEM,
      event: 'tenant.created',
    });
    await ds.getRepository(Tenant).delete(throwaway.id);
    const [{ count }] = await ds.query(
      `SELECT count(*)::int AS count FROM audit_logs WHERE tenant_id = $1`,
      [throwaway.id],
    );
    expect(count).toBe(0);
  });

  it('enforces one incident per (tenant, ingest_key)', async () => {
    const repo = ds.getRepository(Incident);
    const base = {
      severity: IncidentSeverity.P2,
      title: 'dup',
      sourceAlert: {},
      detectedAt: new Date(),
      ingestKey: 'alert-123',
    };
    await repo.insert({ ...base, tenantId: tenantA.id });
    await expect(repo.insert({ ...base, tenantId: tenantA.id })).rejects.toThrow();
    // A different tenant may legitimately reuse the same key.
    await expect(repo.insert({ ...base, tenantId: tenantB.id })).resolves.toBeDefined();
  });

  it('finds similar resolved incidents, scoped to the tenant', async () => {
    const store = new IncidentEmbeddingStore(ds);
    const current = await incident(tenantA.id, 'HighCPU auth-service');
    const pastA = await incident(tenantA.id, 'HighCPU auth-service (last week)');
    const pastB = await incident(tenantB.id, 'HighCPU auth-service (other tenant)');
    await ds.query(`UPDATE incidents SET status = 'resolved' WHERE id = ANY($1)`, [
      [pastA.id, pastB.id],
    ]);

    await store.setEmbedding(tenantA.id, pastA.id, unitVector(1));
    await store.setEmbedding(tenantB.id, pastB.id, unitVector(1));

    const similar = await store.findSimilarResolved(tenantA.id, unitVector(1), current.id, 3, 0.75);
    expect(similar.map((s) => s.id)).toEqual([pastA.id]);
    expect(similar[0].similarity).toBeCloseTo(1);

    // Writing through the wrong tenant is a no-op, not a cross-tenant write.
    await store.setEmbedding(tenantB.id, current.id, unitVector(2));
    const [{ has }] = await ds.query(
      `SELECT embedding IS NOT NULL AS has FROM incidents WHERE id = $1`,
      [current.id],
    );
    expect(has).toBe(false);
  });

  it('reverts every migration cleanly and re-applies them', async () => {
    const migrations = await ds.query(`SELECT count(*)::int AS count FROM migrations`);
    for (let i = 0; i < migrations[0].count; i += 1) {
      await ds.undoLastMigration();
    }
    const tables: { table_name: string }[] = await ds.query(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name <> 'migrations'`,
    );
    expect(tables).toEqual([]);
    await ds.runMigrations();
  });
});
