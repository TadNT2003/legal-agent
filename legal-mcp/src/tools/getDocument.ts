import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import type { LawApiClient } from '../lawApi/client.js';

const inputSchema = {
  documentId: z.string().describe('Document UUID.'),
};

export type GetDocumentArgs = z.infer<z.ZodObject<typeof inputSchema>>;

export async function getDocumentHandler(
  lawApi: LawApiClient,
  { documentId }: GetDocumentArgs,
): Promise<CallToolResult> {
  const result = await lawApi.getById(documentId);
  return {
    content: [{ type: 'text', text: JSON.stringify(result) }],
  };
}

export function registerGetDocument(
  server: McpServer,
  lawApi: LawApiClient,
): void {
  server.registerTool(
    'get_document',
    {
      title: 'Get legal document metadata',
      description:
        'Fetch metadata (dates, validity status, issuing body, source URL) for one document by its ID.',
      inputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    (args) => getDocumentHandler(lawApi, args),
  );
}
