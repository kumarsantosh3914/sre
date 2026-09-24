import { randomBytes } from 'crypto';
import { DataSource, DataSourceOptions } from 'typeorm';
import { dataSourceOptions } from '../data-source';

export interface TestDatabase {
  url: string;
  options: Extract<DataSourceOptions, { type: 'postgres' }>;
  destroy(): Promise<void>;
}

const pgOptions = dataSourceOptions as Extract<DataSourceOptions, { type: 'postgres' }>;

interface StartedContainer {
  getConnectionUri(): string;
  stop(): Promise<unknown>;
}

async function startContainer(): Promise<StartedContainer> {
  // Loaded lazily: only needed when no TEST_DATABASE_URL is provided.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { PostgreSqlContainer } = require('@testcontainers/postgresql') as {
    PostgreSqlContainer: new (image: string) => {
      withDatabase(db: string): {
        withUsername(u: string): {
          withPassword(p: string): { start(): Promise<StartedContainer> };
        };
      };
    };
  };
  return new PostgreSqlContainer('pgvector/pgvector:pg16')
    .withDatabase('sreai_test')
    .withUsername('sreai')
    .withPassword('password')
    .start();
}

// A fully-migrated, isolated PostgreSQL database for one test file.
//
// With TEST_DATABASE_URL (CI service container / local docker-compose) a
// throwaway database is created on that server per call, so test files can
// run in parallel against one Postgres. Without it, a pgvector
// testcontainer is started — real PostgreSQL either way, never a mock.
export async function createTestDatabase(): Promise<TestDatabase> {
  const adminUrl = process.env.TEST_DATABASE_URL;

  if (!adminUrl) {
    const container = await startContainer();
    const url = container.getConnectionUri();
    await migrate(url);
    return {
      url,
      options: { ...pgOptions, url, logging: false },
      destroy: async () => {
        await container.stop();
      },
    };
  }

  const dbName = `sreai_test_${randomBytes(6).toString('hex')}`;
  const admin = new DataSource({ type: 'postgres', url: adminUrl });
  await admin.initialize();
  await admin.query(`CREATE DATABASE "${dbName}"`);
  await admin.destroy();

  const url = new URL(adminUrl);
  url.pathname = `/${dbName}`;
  const dbUrl = url.toString();
  await migrate(dbUrl);

  return {
    url: dbUrl,
    options: { ...pgOptions, url: dbUrl, logging: false },
    destroy: async () => {
      const cleanup = new DataSource({ type: 'postgres', url: adminUrl });
      await cleanup.initialize();
      await cleanup.query(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`);
      await cleanup.destroy();
    },
  };
}

async function migrate(url: string): Promise<void> {
  const ds = new DataSource({ ...pgOptions, url, logging: false });
  await ds.initialize();
  await ds.runMigrations();
  await ds.destroy();
}
