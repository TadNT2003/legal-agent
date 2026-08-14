import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { config } from '../config.js';
import { createLogger } from '../tools/logging.js';

const logger = createLogger('mcp-client');
const HEARTBEAT_INTERVAL_MS = 60_000;
const RECONNECT_BACKOFF_MS = 2000;

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

/**
 * Checks if an error indicates a lost/broken transport connection.
 * Network-level failures (ECONNREFUSED, ECONNRESET, EPIPE, ETIMEDOUT)
 * and generic "fetch failed" / closed connection errors are transient.
 */
function isConnectionError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const msg = error.message.toLowerCase();
  if (
    msg.includes('econnrefused') ||
    msg.includes('econnreset') ||
    msg.includes('epipe') ||
    msg.includes('etimedout') ||
    msg.includes('fetch failed') ||
    msg.includes('closed') ||
    msg.includes('network')
  ) {
    return true;
  }
  const cause = error.cause;
  if (cause instanceof Error) {
    const causeMsg = cause.message.toLowerCase();
    if (
      causeMsg.includes('econnrefused') ||
      causeMsg.includes('econnreset') ||
      causeMsg.includes('fetch failed')
    ) {
      return true;
    }
  }
  return false;
}

/** Factory function to create a new MCP client, used for reconnection. */
async function createNewClient(): Promise<Client> {
  return createMcpClient();
}

/**
 * ReconnectingMcpClient wraps the raw MCP Client and provides:
 * 1. Automatic reconnect on connection errors during tool calls
 * 2. A periodic heartbeat that detects dead connections and reconnects
 *
 * This keeps the same external interface as the raw Client for
 * listTools/getPrompt, but intercepts callTool for reconnection logic.
 */
export class ReconnectingMcpClient {
  #client: Client;
  #heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  #reconnecting = false;

  constructor(client: Client) {
    this.#client = client;
  }

  /**
   * Start the periodic heartbeat. Calls listTools every HEARTBEAT_INTERVAL_MS
   * to detect dead connections. On failure, reconnects proactively.
   */
  startHeartbeat(): void {
    this.#heartbeatTimer = setInterval(() => {
      void this.#heartbeat();
    }, HEARTBEAT_INTERVAL_MS);
    logger.log(`Heartbeat started (every ${HEARTBEAT_INTERVAL_MS}ms)`);
  }

  /** Stop the heartbeat. Call during shutdown. */
  stopHeartbeat(): void {
    if (this.#heartbeatTimer) {
      clearInterval(this.#heartbeatTimer);
      this.#heartbeatTimer = null;
      logger.log('Heartbeat stopped');
    }
  }

  async #heartbeat(): Promise<void> {
    try {
      await this.#client.listTools();
    } catch (error) {
      logger.error('Heartbeat failed — attempting reconnect', error);
      await this.#reconnect();
    }
  }

  /**
   * Calls an MCP tool with automatic reconnection on connection errors.
   * On a connection failure, recreates the client transport and retries
   * the tool call once.
   */
  async callTool(
    name: string,
    args: Record<string, unknown>,
  ): Promise<CallToolResult> {
    try {
      return (await this.#client.callTool({ name, arguments: args })) as CallToolResult;
    } catch (error) {
      if (!isConnectionError(error)) {
        throw error;
      }
      logger.error(
        `Connection error calling ${name}, reconnecting and retrying...`,
        error,
      );
      await this.#reconnect();
      await sleep(RECONNECT_BACKOFF_MS);
      return (await this.#client.callTool({ name, arguments: args })) as CallToolResult;
    }
  }

  /** Re-create the underlying client transport. */
  async #reconnect(): Promise<void> {
    if (this.#reconnecting) {
      return;
    }
    this.#reconnecting = true;
    try {
      await this.#client.close();
    } catch {
      // close() may throw if the transport is already dead; ignore.
    }
    try {
      this.#client = await createNewClient();
      logger.log('Reconnected to MCP server');
    } catch (error) {
      logger.error('Failed to reconnect to MCP server', error);
      throw error;
    } finally {
      this.#reconnecting = false;
    }
  }

  /** Delegates to the underlying client for non-tool-call operations. */
  listTools() {
    return this.#client.listTools();
  }

  getPrompt(name: string) {
    return this.#client.getPrompt({ name });
  }

  /** Close the underlying client transport. */
  async close(): Promise<void> {
    this.stopHeartbeat();
    try {
      await this.#client.close();
    } catch {
      // Already closed.
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
