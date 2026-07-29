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

  NEO4J_URI: Joi.string().required(),
  NEO4J_USERNAME: Joi.string().required(),
  NEO4J_PASSWORD: Joi.string().required(),

  CHROMADB_URL: Joi.string().uri().required(),

  LAWS_DOWNLOAD_DIR: Joi.string().default('../laws'),

  VBPL_BASE_URL: Joi.string().uri().default('https://vbpl.vn'),
  LAW_INDEX_MAX_TIER: Joi.number().min(1).max(14).default(9),
  LAW_INDEX_REQUEST_DELAY_MS: Joi.number().default(1000),
  LAW_INDEX_HEADLESS: Joi.boolean().default(true),
});
