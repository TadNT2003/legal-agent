import 'dotenv/config';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createMcpExpressApp } from '@modelcontextprotocol/sdk/server/express.js';
import { config } from './config.js';
import { LawApiClient } from './lawApi/client.js';
import { registerLegalLookupGuidance } from './prompts/legalLookupGuidance.js';
import { createLogger } from './tools/logging.js';
import { registerGetDocument } from './tools/getDocument.js';
import { registerGetDocumentNodes } from './tools/getDocumentNodes.js';
import { registerGetReferences } from './tools/getReferences.js';
import { registerSearchDocuments } from './tools/searchDocuments.js';

const logger = createLogger('index');

/**
 * A fresh McpServer per request, matching the SDK's own stateless example
 * (src/examples/server/simpleStatelessStreamableHttp.ts) — no session state
 * to leak between independent tool calls, and no session-tracking overhead
 * a simple API-style server like this one doesn't need.
 */
function createServer(): McpServer {
  const server = new McpServer({ name: 'legal-mcp', version: '0.0.1' });

  const lawApi = new LawApiClient(config.lawApi.baseUrl);

  registerSearchDocuments(server, lawApi);
  registerGetDocument(server, lawApi);
  registerGetDocumentNodes(server, lawApi);
  registerGetReferences(server, lawApi);
  registerLegalLookupGuidance(server);

  return server;
}

const app = createMcpExpressApp();

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.post('/mcp', async (req, res) => {
  const server = createServer();
  try {
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
    });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body as unknown);
    res.on('close', () => {
      void transport.close();
      void server.close();
    });
  } catch (error) {
    logger.error('Error handling MCP request', error);
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: '2.0',
        error: { code: -32603, message: 'Internal server error' },
        id: null,
      });
    }
  }
});

app.get('/mcp', (_req, res) => {
  res.writeHead(405).end(
    JSON.stringify({
      jsonrpc: '2.0',
      error: { code: -32000, message: 'Method not allowed.' },
      id: null,
    }),
  );
});

app.delete('/mcp', (_req, res) => {
  res.writeHead(405).end(
    JSON.stringify({
      jsonrpc: '2.0',
      error: { code: -32000, message: 'Method not allowed.' },
      id: null,
    }),
  );
});

app.listen(config.server.port, () => {
  logger.log(
    `legal-mcp listening on port ${config.server.port} (POST /mcp, GET /health)`,
  );
});
