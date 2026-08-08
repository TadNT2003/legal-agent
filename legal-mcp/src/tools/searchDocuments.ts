import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import type { LawApiClient } from '../lawApi/client.js';

/**
 * Hard server-side default, not just a description hint — see
 * docs/plan/legal-mcp-plan.md's "Validity default" decision. Validity
 * filtering must not depend on the calling model/agent reliably following a
 * text instruction; agent-bot's build already showed a weak model ignoring
 * exactly that kind of nudge.
 */
export const DEFAULT_VALIDITY_STATUS = 'Còn hiệu lực';

const inputSchema = {
  keyword: z.string().optional().describe('Free-text search term.'),
  searchScope: z
    .enum(['tieu-de', 'so-hieu', 'noi-dung'])
    .optional()
    .describe(
      '"tieu-de" (default) = title+citation, "so-hieu" = citation only, "noi-dung" = full text.',
    ),
  documentTypes: z
    .array(z.string())
    .optional()
    .describe(
      'e.g. ["Luật", "Nghị định"]. Must match vbpl.vn document type strings exactly.',
    ),
  issuingBodies: z
    .array(z.string())
    .optional()
    .describe('e.g. ["Chính phủ", "Quốc hội"].'),
  validityStatus: z
    .string()
    .optional()
    .describe(
      'e.g. "Còn hiệu lực", "Hết hiệu lực toàn bộ". If omitted, defaults to ' +
        `"${DEFAULT_VALIDITY_STATUS}" (still in force) unless includeHistorical is set.`,
    ),
  includeHistorical: z
    .boolean()
    .optional()
    .describe(
      'Set true to disable the default still-in-force filter and search across all validity ' +
        'statuses (historical/repealed included). Only set this when the user is clearly asking ' +
        'about historical or repealed law.',
    ),
  page: z.number().int().min(1).optional(),
  pageSize: z.number().int().min(1).max(50).optional(),
};

export type SearchDocumentsArgs = z.infer<z.ZodObject<typeof inputSchema>>;

export async function searchDocumentsHandler(
  lawApi: LawApiClient,
  args: SearchDocumentsArgs,
): Promise<CallToolResult> {
  const { includeHistorical, validityStatus, ...rest } = args;
  const effectiveValidityStatus =
    validityStatus ?? (includeHistorical ? undefined : DEFAULT_VALIDITY_STATUS);

  const result = await lawApi.search({
    ...rest,
    validityStatus: effectiveValidityStatus,
  });

  return {
    content: [{ type: 'text', text: JSON.stringify(result) }],
  };
}

export function registerSearchDocuments(
  server: McpServer,
  lawApi: LawApiClient,
): void {
  server.registerTool(
    'search_documents',
    {
      title: 'Search Vietnamese legal documents',
      description:
        'Search Vietnamese legal documents by keyword, type, issuing body, or validity status. ' +
        'Use this first to find candidate documents before fetching their text with get_document_nodes. ' +
        `Results default to "${DEFAULT_VALIDITY_STATUS}" (still in force) — pass includeHistorical: true ` +
        'to search historical/repealed law instead.',
      inputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    (args) => searchDocumentsHandler(lawApi, args),
  );
}
