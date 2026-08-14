function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export const config = {
  server: {
    port: Number(process.env['PORT'] ?? 3100),
  },
  mcp: {
    serverUrl: requireEnv('MCP_SERVER_URL'),
  },
  llm: {
    baseUrl: requireEnv('OPENAI_BASE_URL'),
    apiKey: requireEnv('OPENAI_API_KEY'),
    model: requireEnv('OPENAI_MODEL'),
  },
  discord: {
    token: requireEnv('DISCORD_BOT_TOKEN'),
  },
  db: {
    host: process.env.POSTGRES_HOST ?? 'localhost',
    port: parseInt(process.env.POSTGRES_PORT ?? '5432', 10),
    user: process.env.POSTGRES_USER ?? 'legal_agent',
    password: process.env.POSTGRES_PASSWORD ?? '',
    database: process.env.POSTGRES_DB ?? 'legal_agent',
  },
} as const;
