function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export const config = {
  server: {
    port: Number(process.env['PORT'] ?? 3200),
  },
  lawApi: {
    baseUrl: requireEnv('LAW_API_BASE_URL'),
  },
} as const;
