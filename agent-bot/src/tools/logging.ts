export function createLogger(moduleName: string) {
  return {
    log: (message: string) =>
      console.log(`[${moduleName}] ${new Date().toISOString()} ${message}`),
    error: (message: string, error?: unknown) =>
      console.error(
        `[${moduleName}] ${new Date().toISOString()} ${message}`,
        error,
      ),
  };
}

export type Logger = ReturnType<typeof createLogger>;
