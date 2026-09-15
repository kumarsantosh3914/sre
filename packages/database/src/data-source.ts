import 'reflect-metadata';
import { DataSource, DataSourceOptions } from 'typeorm';

// Entities and migrations are added as part of the "PostgreSQL + pgvector +
// migrations" foundation task. `synchronize` must never be true — see CLAUDE.md.
export const dataSourceOptions: DataSourceOptions = {
  type: 'postgres',
  url: process.env.DATABASE_URL,
  synchronize: false,
  logging: process.env.NODE_ENV !== 'production',
  entities: [__dirname + '/entities/**/*.entity{.ts,.js}'],
  migrations: [__dirname + '/migrations/**/*{.ts,.js}'],
};

export const AppDataSource = new DataSource(dataSourceOptions);
