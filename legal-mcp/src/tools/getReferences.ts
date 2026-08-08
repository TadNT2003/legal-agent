import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import type { LawApiClient } from '../lawApi/client.js';

const REFERENCE_TYPE_OPTIONS = [
  'cites',
  'amends',
  'repeals',
  'corrects',
  'implements',
  'guides',
  'has_basis',
  'explains',
  'promulgates',
  'defines_term',
] as const;

const inputSchema = {
  documentId: z.string().describe('Document UUID.'),
  direction: z
    .enum(['outgoing', 'incoming', 'all'])
    .optional()
    .describe(
      '"outgoing" (default) = references where this document is the source (what it cites/amends/...). ' +
        '"incoming" = references where this document is the target (what cites/amends it). "all" = both.',
    ),
  referenceType: z
    .enum(REFERENCE_TYPE_OPTIONS)
    .optional()
    .describe('Filter to one reference type, e.g. "amends", "repeals".'),
};

export type GetReferencesArgs = z.infer<z.ZodObject<typeof inputSchema>>;

export async function getReferencesHandler(
  lawApi: LawApiClient,
  { documentId, direction, referenceType }: GetReferencesArgs,
): Promise<CallToolResult> {
  const result = await lawApi.getReferences({
    documentId,
    direction,
    referenceType,
  });
  return {
    content: [{ type: 'text', text: JSON.stringify(result) }],
  };
}

/**
 * Not wrapped by agent-bot today. Fills, against today's Postgres data, the
 * role docs/research/legal-ai-retrieval-landscape.md §4b assigns to Neo4j's
 * get_amendment_chain/verify_citation tools — same name/shape can have its
 * backing store swapped to Neo4j later without breaking callers. Useful for
 * "is this still the current text / what amended it / has it been repealed"
 * questions that plain text search can't answer.
 */
export function registerGetReferences(
  server: McpServer,
  lawApi: LawApiClient,
): void {
  server.registerTool(
    'get_references',
    {
      title: 'Get document amendment/citation references',
      description:
        'Fetch the citation/amendment relationships for a document — what it cites, amends, repeals, ' +
        'implements, etc. (outgoing), or what other documents do that to it (incoming). Use this to ' +
        'check whether a document has been amended or repealed, or to find its implementing/guiding ' +
        'documents, before treating its text as the final word.',
      inputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    (args) => getReferencesHandler(lawApi, args),
  );
}
