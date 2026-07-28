import { registerAs } from '@nestjs/config';

export const appConfig = registerAs('app', () => ({
  nodeEnv: process.env.NODE_ENV,
  port: parseInt(process.env.PORT ?? '3000', 10),
}));

export const postgresConfig = registerAs('postgres', () => ({
  host: process.env.POSTGRES_HOST,
  port: parseInt(process.env.POSTGRES_PORT ?? '5432', 10),
  username: process.env.POSTGRES_USER,
  password: process.env.POSTGRES_PASSWORD,
  database: process.env.POSTGRES_DB,
}));

export const opensearchConfig = registerAs('opensearch', () => ({
  node: process.env.OPENSEARCH_NODE,
  username: process.env.OPENSEARCH_USERNAME,
  password: process.env.OPENSEARCH_PASSWORD,
}));

export const neo4jConfig = registerAs('neo4j', () => ({
  uri: process.env.NEO4J_URI,
  username: process.env.NEO4J_USERNAME,
  password: process.env.NEO4J_PASSWORD,
}));

export const chromadbConfig = registerAs('chromadb', () => ({
  url: process.env.CHROMADB_URL,
}));
