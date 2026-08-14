import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { config } from '../config.js';

/**
 * Connects once at startup and is reused for every chat() call thereafter —
 * legal-mcp's server is stateless per-request on its side, but the client
 * transport itself is safe to hold open and reuse across many logical
 * tool calls, confirmed live during legal-mcp's own Phase 1 smoke test.
 */
export async function createMcpClient(): Promise<Client> {
  const client = new Client({ name: 'agent-bot', version: '0.0.1' });
  const transport = new StreamableHTTPClientTransport(
    new URL(config.mcp.serverUrl),
  );
  await client.connect(transport);
  return client;
}
