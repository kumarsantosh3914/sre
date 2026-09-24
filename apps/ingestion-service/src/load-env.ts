import { join } from 'path';
import { config as loadEnv } from 'dotenv';

// Imported first by main.ts: @sreai/database's dataSourceOptions (and the
// queue/Redis helpers) read process.env at module-evaluation time, which
// happens as soon as AppModule is required — before ConfigModule.forRoot()
// runs. pnpm runs scripts with cwd = this package, so point at the repo
// root .env explicitly (same path from src/ under `nest start` and from
// dist/ under `node dist/main.js`). Real env vars always win.
loadEnv({ path: join(__dirname, '..', '..', '..', '.env') });
