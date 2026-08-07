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
  lawApi: {
    baseUrl: requireEnv('LAW_API_BASE_URL'),
  },
  llm: {
    baseUrl: requireEnv('OPENAI_BASE_URL'),
    apiKey: requireEnv('OPENAI_API_KEY'),
    model: requireEnv('OPENAI_MODEL'),
  },
  discord: {
    token: requireEnv('DISCORD_BOT_TOKEN'),
  },
} as const;
