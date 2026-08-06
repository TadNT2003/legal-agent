import { Module } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { Client } from '@opensearch-project/opensearch';
import { opensearchConfig } from '../../config/configuration';

export const OPENSEARCH_CLIENT = Symbol('OPENSEARCH_CLIENT');

/**
 * Mirrors persistence/db.module.ts's shape. Reuses the existing `opensearch`
 * connection namespace (src/config/configuration.ts) rather than defining a
 * new one — see opensearch.config.ts for the projector-specific (index/alias
 * naming, batching) namespace this is deliberately kept separate from.
 */
@Module({
  providers: [
    {
      provide: OPENSEARCH_CLIENT,
      inject: [opensearchConfig.KEY],
      useFactory: (config: ConfigType<typeof opensearchConfig>): Client => {
        // username/password are Joi `.required()` (env.validation.ts) — always
        // set by the time this factory runs, since the app fails fast at
        // startup otherwise.
        return new Client({
          node: config.node,
          auth: { username: config.username!, password: config.password! },
          requestTimeout: config.requestTimeoutMs,
          ssl: { rejectUnauthorized: config.rejectUnauthorized },
        });
      },
    },
  ],
  exports: [OPENSEARCH_CLIENT],
})
export class OpensearchClientModule {}
