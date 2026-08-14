import { drizzle } from 'drizzle-orm/node-postgres';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from '../schema/index.js';

export function createDb(config: {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
}): {
  db: NodePgDatabase<typeof schema>;
  pool: Pool;
} {
  const pool = new Pool({
    host: config.host,
    port: config.port,
    user: config.user,
    password: config.password,
    database: config.database,
    max: 10,
  });
  const db = drizzle(pool, { schema });
  return { db, pool };
}

export async function closeDb(pool: Pool): Promise<void> {
  await pool.end();
}