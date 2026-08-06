import { registerAs } from '@nestjs/config';

/**
 * Index/alias naming and write-batching knobs for the OpenSearch projector —
 * separate from the `opensearch` namespace in src/config/configuration.ts,
 * which only holds cluster connection info. Colocated here rather than in
 * that shared file, same pattern as law-index.config.ts.
 */
export const opensearchProjectorConfig = registerAs(
  'opensearchProjector',
  () => ({
    indexBaseName:
      process.env.OPENSEARCH_PROJECTOR_INDEX_BASE_NAME ?? 'legal_provisions',
    indexVersion: parseInt(
      process.env.OPENSEARCH_PROJECTOR_INDEX_VERSION ?? '1',
      10,
    ),
    readAlias:
      process.env.OPENSEARCH_PROJECTOR_READ_ALIAS ?? 'legal-provisions-read',
    writeAlias:
      process.env.OPENSEARCH_PROJECTOR_WRITE_ALIAS ?? 'legal-provisions-write',
    // Flush the bulk buffer at whichever of these is hit first — the byte
    // cap exists solely for the ~1MB phụ lục documents.
    bulkMaxDocs: parseInt(
      process.env.OPENSEARCH_PROJECTOR_BULK_MAX_DOCS ?? '500',
      10,
    ),
    bulkMaxBytes: parseInt(
      process.env.OPENSEARCH_PROJECTOR_BULK_MAX_BYTES ?? `${5 * 1024 * 1024}`,
      10,
    ),
    // Single-node cluster: 1 replica would leave the index permanently yellow.
    numberOfShards: parseInt(
      process.env.OPENSEARCH_PROJECTOR_NUMBER_OF_SHARDS ?? '1',
      10,
    ),
    numberOfReplicas: parseInt(
      process.env.OPENSEARCH_PROJECTOR_NUMBER_OF_REPLICAS ?? '0',
      10,
    ),
  }),
);

/** `legal_provisions_v1`, etc. — the app never references this directly outside index-admin.service.ts; every read/write goes through the read/write aliases. */
export function buildConcreteIndexName(
  config: { indexBaseName: string; indexVersion: number },
  version = config.indexVersion,
): string {
  return `${config.indexBaseName}_v${version}`;
}
