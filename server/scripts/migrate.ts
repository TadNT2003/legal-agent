// `drizzle-kit migrate` (the CLI) exits 1 with no error output in this
// environment (Windows + git-bash — its spinner/CLI wrapper swallows
// whatever the real error is; the underlying drizzle-orm migrator works
// fine when called directly, as this script does). Use `npm run db:migrate`
// instead of `npx drizzle-kit migrate` until that's root-caused.
import * as dotenv from 'dotenv';
dotenv.config();

import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';

async function main() {
  const pool = new Pool({
    host: process.env.POSTGRES_HOST,
    port: parseInt(process.env.POSTGRES_PORT ?? '5432', 10),
    user: process.env.POSTGRES_USER,
    password: process.env.POSTGRES_PASSWORD,
    database: process.env.POSTGRES_DB,
  });
  const db = drizzle(pool);
  try {
    await migrate(db, {
      migrationsFolder: './src/law-index/persistence/migrations',
    });
    console.log('Migrations applied.');
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
