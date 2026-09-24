import 'reflect-metadata';
import { DataSource, DataSourceOptions } from 'typeorm';

// `synchronize` must never be true — schema changes go through migrations
// only (CLAUDE.md rule #1). Query logging is opt-in: TypeORM's logger
// writes straight to the console, bypassing the structured Winston logger.
export const dataSourceOptions: DataSourceOptions = {
  type: 'postgres',
  url: process.env.DATABASE_URL,
  synchronize: false,
  logging: process.env.DB_QUERY_LOGGING === 'true',
  entities: [__dirname + '/entities/**/*.entity{.ts,.js}'],
  migrations: [__dirname + '/migrations/**/*{.ts,.js}'],
};

export const AppDataSource = new DataSource(dataSourceOptions);
