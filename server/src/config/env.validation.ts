import * as Joi from 'joi';

export const envValidationSchema = Joi.object({
  NODE_ENV: Joi.string()
    .valid('development', 'production', 'test')
    .default('development'),
  PORT: Joi.number().default(3000),

  POSTGRES_HOST: Joi.string().required(),
  POSTGRES_PORT: Joi.number().default(5432),
  POSTGRES_USER: Joi.string().required(),
  POSTGRES_PASSWORD: Joi.string().required(),
  POSTGRES_DB: Joi.string().required(),

  OPENSEARCH_NODE: Joi.string().uri().required(),
  OPENSEARCH_USERNAME: Joi.string().required(),
  OPENSEARCH_PASSWORD: Joi.string().required(),
  OPENSEARCH_REJECT_UNAUTHORIZED: Joi.boolean().default(true),
  OPENSEARCH_REQUEST_TIMEOUT_MS: Joi.number().default(30000),

  // --- OpenSearch projector (server/src/opensearch/) ---
  OPENSEARCH_PROJECTOR_INDEX_BASE_NAME:
    Joi.string().default('legal-provisions'),
  OPENSEARCH_PROJECTOR_INDEX_VERSION: Joi.number().default(1),
  OPENSEARCH_PROJECTOR_READ_ALIAS: Joi.string().default(
    'legal-provisions-read',
  ),
  OPENSEARCH_PROJECTOR_WRITE_ALIAS: Joi.string().default(
    'legal-provisions-write',
  ),
  OPENSEARCH_PROJECTOR_BULK_MAX_DOCS: Joi.number().default(500),
  OPENSEARCH_PROJECTOR_BULK_MAX_BYTES: Joi.number().default(5 * 1024 * 1024),
  OPENSEARCH_PROJECTOR_NUMBER_OF_SHARDS: Joi.number().default(1),
  OPENSEARCH_PROJECTOR_NUMBER_OF_REPLICAS: Joi.number().default(0),

  NEO4J_URI: Joi.string().required(),
  NEO4J_USERNAME: Joi.string().required(),
  NEO4J_PASSWORD: Joi.string().required(),

  CHROMADB_URL: Joi.string().uri().required(),

  LAWS_DOWNLOAD_DIR: Joi.string().default('../laws'),

  VBPL_BASE_URL: Joi.string().uri().default('https://vbpl.vn'),
  LAW_INDEX_MAX_TIER: Joi.number().min(1).max(14).default(9),
  LAW_INDEX_REQUEST_DELAY_MS: Joi.number().default(1000),
  LAW_INDEX_HEADLESS: Joi.boolean().default(true),
  LAW_INDEX_BROWSER_RECYCLE_INTERVAL: Joi.number().min(0).default(20),

  REDIS_HOST: Joi.string().default('localhost'),
  REDIS_PORT: Joi.number().default(6379),
  REDIS_PASSWORD: Joi.string().allow('').default(''),
});
