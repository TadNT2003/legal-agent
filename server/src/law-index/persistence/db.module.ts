import { Module } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import { drizzle, NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { postgresConfig } from '../../config/configuration';
import * as schema from './schema';

export const DRIZZLE = Symbol('DRIZZLE_CLIENT');
export type DrizzleDb = NodePgDatabase<typeof schema>;

/**
 * Reuses the existing postgresConfig namespace (src/config/configuration.ts)
 * rather than defining a new one — this module is the first thing in the
 * repo to actually connect to Postgres, but the connection settings were
 * already provisioned/validated for the eventual source-of-truth store.
 */
@Module({
  providers: [
    {
      provide: DRIZZLE,
      inject: [postgresConfig.KEY],
      useFactory: (config: ConfigType<typeof postgresConfig>): DrizzleDb => {
        const pool = new Pool({
          host: config.host,
          port: config.port,
          user: config.username,
          password: config.password,
          database: config.database,
        });
        return drizzle(pool, { schema });
      },
    },
  ],
  exports: [DRIZZLE],
})
export class DbModule {}
