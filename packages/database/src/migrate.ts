import 'reflect-metadata';
import { createWinstonLogger, errorMeta } from '@sreai/shared';
import { DataSource } from 'typeorm';
import { dataSourceOptions } from './data-source';

// Production migration runner (compiled JS — no ts-node in images):
//   node node_modules/@sreai/database/dist/migrate.js
// Each migration runs in its own transaction; a failure stops the run and
// exits non-zero so a deploy never proceeds against a half-migrated schema.
async function main(): Promise<void> {
  const logger = createWinstonLogger('migrate');
  const dataSource = new DataSource({ ...dataSourceOptions, logging: false });
  try {
    await dataSource.initialize();
    const applied = await dataSource.runMigrations({ transaction: 'each' });
    logger.info('Migrations complete', { applied: applied.map((m) => m.name) });
  } catch (err) {
    logger.error('Migration run failed', errorMeta(err));
    process.exitCode = 1;
  } finally {
    if (dataSource.isInitialized) await dataSource.destroy();
  }
}

void main();
