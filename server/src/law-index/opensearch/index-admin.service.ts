import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { Client } from '@opensearch-project/opensearch';
import type {
  ClusterHealthResponse,
  CountResponse,
  IndicesExistsResponse,
  IndicesGetAliasResponse,
} from '@opensearch-project/opensearch/api/types';
import { OPENSEARCH_CLIENT } from './opensearch-client.module';
import {
  buildConcreteIndexName,
  opensearchProjectorConfig,
} from './opensearch.config';
import {
  LEGAL_PROVISIONS_ANALYSIS_SETTINGS,
  LEGAL_PROVISIONS_MAPPINGS,
  LEGAL_PROVISIONS_MAX_ANALYZED_OFFSET,
} from './legal-provisions.mapping';

export interface IndexStatus {
  readAlias: string;
  writeAlias: string;
  /** Null when the read alias doesn't resolve to any index yet (ensureIndex was never called). */
  resolvedIndex: string | null;
  health: 'green' | 'yellow' | 'red' | null;
  docsCount: number | null;
}

function isNotFoundError(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'statusCode' in err &&
    (err as { statusCode?: number }).statusCode === 404
  );
}

/**
 * OpenSearch-only — never touches Postgres. `ensureIndex`/`promoteAliases`/
 * `dropIndex` are the write path (index lifecycle); `getStatus` is the
 * manual stand-in for the not-yet-built CDC reconciliation job (plan
 * "Deferred").
 */
@Injectable()
export class IndexAdminService {
  constructor(
    @Inject(OPENSEARCH_CLIENT) private readonly client: Client,
    @Inject(opensearchProjectorConfig.KEY)
    private readonly config: ConfigType<typeof opensearchProjectorConfig>,
  ) {}

  /**
   * Creates the concrete index for the current config version with mappings,
   * analysis settings, and both aliases attached in one call — idempotent,
   * a no-op if the index already exists (does not verify its aliases/mapping
   * still match; a real mapping change needs a new version + blue/green
   * promotion, not a mutation of an existing index).
   */
  async ensureIndex(): Promise<{ created: boolean; index: string }> {
    const index = buildConcreteIndexName(this.config);
    const { body: exists } =
      await this.client.indices.exists<IndicesExistsResponse>({ index });
    if (exists) return { created: false, index };

    await this.client.indices.create({
      index,
      body: {
        settings: {
          index: {
            number_of_shards: this.config.numberOfShards,
            number_of_replicas: this.config.numberOfReplicas,
            highlight: {
              max_analyzed_offset: LEGAL_PROVISIONS_MAX_ANALYZED_OFFSET,
            },
          },
          analysis: LEGAL_PROVISIONS_ANALYSIS_SETTINGS,
        },
        mappings: LEGAL_PROVISIONS_MAPPINGS,
        aliases: {
          [this.config.readAlias]: {},
          [this.config.writeAlias]: { is_write_index: true },
        },
      },
    });

    return { created: true, index };
  }

  /**
   * Atomic blue/green alias swap: moves both aliases off whatever index
   * currently holds them onto `targetVersion`'s concrete index in a single
   * `_aliases` call, so readers never see a moment with neither alias set.
   * `remove` against `index: '*'` is safe here — it silently matches zero
   * indices the first time this ever runs, rather than needing to know the
   * previous index name up front.
   */
  async promoteAliases(targetVersion: number): Promise<{
    index: string;
    readAlias: string;
    writeAlias: string;
  }> {
    const index = buildConcreteIndexName(this.config, targetVersion);

    await this.client.indices.updateAliases({
      body: {
        actions: [
          { remove: { index: '*', alias: this.config.readAlias } },
          { remove: { index: '*', alias: this.config.writeAlias } },
          { add: { index, alias: this.config.readAlias } },
          {
            add: {
              index,
              alias: this.config.writeAlias,
              is_write_index: true,
            },
          },
        ],
      },
    });

    return {
      index,
      readAlias: this.config.readAlias,
      writeAlias: this.config.writeAlias,
    };
  }

  /** Alias->index resolution, cluster health, and doc count. */
  async getStatus(): Promise<IndexStatus> {
    const resolvedIndex = await this.resolveAliasIndex(this.config.readAlias);
    if (!resolvedIndex) {
      return {
        readAlias: this.config.readAlias,
        writeAlias: this.config.writeAlias,
        resolvedIndex: null,
        health: null,
        docsCount: null,
      };
    }

    const { body: health } =
      await this.client.cluster.health<ClusterHealthResponse>({
        index: resolvedIndex,
      });
    const { body: count } = await this.client.count<CountResponse>({
      index: resolvedIndex,
    });

    return {
      readAlias: this.config.readAlias,
      writeAlias: this.config.writeAlias,
      resolvedIndex,
      health: health.status,
      docsCount: count.count,
    };
  }

  /** Refuses to drop an index still attached to either alias — the safety net against dropping the live read/write target. */
  async dropIndex(index: string): Promise<void> {
    if (await this.isAliased(index)) {
      throw new BadRequestException(
        `Refusing to drop index "${index}" — it is still attached to ${this.config.readAlias} or ${this.config.writeAlias}. Promote aliases off it first.`,
      );
    }
    await this.client.indices.delete({ index });
  }

  /** `dropIndex` keyed by version number (`DELETE /index/:version`) rather than the concrete index name directly. */
  async dropIndexVersion(version: number): Promise<void> {
    await this.dropIndex(buildConcreteIndexName(this.config, version));
  }

  private async resolveAliasIndex(alias: string): Promise<string | null> {
    try {
      const { body } =
        await this.client.indices.getAlias<IndicesGetAliasResponse>({
          name: alias,
        });
      return Object.keys(body)[0] ?? null;
    } catch (err) {
      if (isNotFoundError(err)) return null;
      throw err;
    }
  }

  private async isAliased(index: string): Promise<boolean> {
    try {
      const { body } =
        await this.client.indices.getAlias<IndicesGetAliasResponse>({ index });
      const aliases = Object.keys(body[index]?.aliases ?? {});
      return (
        aliases.includes(this.config.readAlias) ||
        aliases.includes(this.config.writeAlias)
      );
    } catch (err) {
      if (isNotFoundError(err)) return false;
      throw err;
    }
  }
}
