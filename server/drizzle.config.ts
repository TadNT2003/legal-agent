import { defineConfig } from 'drizzle-kit';
import * as dotenv from 'dotenv';

dotenv.config();

// Reads the same POSTGRES_* env vars as src/config/configuration.ts's
// postgresConfig — drizzle-kit runs as a standalone CLI outside Nest's DI, so
// it can't consume that ConfigModule-registered factory directly.
export default defineConfig({
  schema: './src/persistence/schema/index.ts',
  out: './src/persistence/migrations',
  dialect: 'postgresql',
  dbCredentials: {
    host: process.env.POSTGRES_HOST ?? 'localhost',
    port: parseInt(process.env.POSTGRES_PORT ?? '5432', 10),
    user: process.env.POSTGRES_USER ?? 'legal_agent',
    password: process.env.POSTGRES_PASSWORD ?? '',
    database: process.env.POSTGRES_DB ?? 'legal_agent',
  },
});
