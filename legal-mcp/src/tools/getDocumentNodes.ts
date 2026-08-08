import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import type { LawApiClient } from '../lawApi/client.js';
import type { LawNode } from '../lawApi/types.js';

const NODE_TYPE_OPTIONS = [
  'phan',
  'chuong',
  'muc',
  'tieu_muc',
  'dieu',
  'khoan',
  'diem',
  'phu_luc',
] as const;

const inputSchema = {
  documentId: z.string().describe('Document UUID.'),
  nodeType: z.enum(NODE_TYPE_OPTIONS).optional(),
  number: z
    .string()
    .optional()
    .describe(
      'Ordinal, e.g. "5" for Điều 5, "2" for Khoản 2, "a" for Điểm a. Used with nodeType.',
    ),
  nodeId: z.string().optional().describe('Node UUID, overrides nodeType+number.'),
};

export type GetDocumentNodesArgs = z.infer<z.ZodObject<typeof inputSchema>>;

interface LawNodeOutline {
  id: string;
  nodeType: string;
  label: string;
  ordinal: string;
  heading: string | null;
  contentClass: string | null;
  path: string;
  children: LawNodeOutline[];
}

/**
 * Strips full text from a node tree, keeping only structure. This is
 * genuine context-safety (a document can have hundreds of Điều), not a
 * model-specific compensation — it carries over from agent-bot as-is.
 */
function toOutline(node: LawNode): LawNodeOutline {
  return {
    id: node.id,
    nodeType: node.nodeType,
    label: node.label,
    ordinal: node.ordinal,
    heading: node.heading,
    contentClass: node.contentClass,
    path: node.path,
    children: node.children.map(toOutline),
  };
}

export async function getDocumentNodesHandler(
  lawApi: LawApiClient,
  { documentId, nodeType, number, nodeId }: GetDocumentNodesArgs,
): Promise<CallToolResult> {
  const wantsText = Boolean(nodeId) || Boolean(nodeType);
  const result = await lawApi.getNodes({
    documentId,
    nodeType,
    number,
    nodeId,
  });

  const payload = wantsText
    ? result
    : { ...result, nodes: result.nodes.map(toOutline) };

  return {
    content: [{ type: 'text', text: JSON.stringify(payload) }],
  };
}

export function registerGetDocumentNodes(
  server: McpServer,
  lawApi: LawApiClient,
): void {
  server.registerTool(
    'get_document_nodes',
    {
      title: 'Get document Điều/Khoản/Điểm structure',
      description:
        'Fetch the Điều/Khoản/Điểm structure of a document. ' +
        'Omitting both nodeType+number and nodeId returns an outline only (labels/headings, no text) ' +
        'to avoid flooding context with an entire document’s text — call again with nodeType+number ' +
        '(e.g. nodeType="dieu", number="5") or nodeId to get the full text of one specific clause.',
      inputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    (args) => getDocumentNodesHandler(lawApi, args),
  );
}
