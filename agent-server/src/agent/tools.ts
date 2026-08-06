import type OpenAI from 'openai';
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
];

export const AGENT_TOOLS: OpenAI.Chat.Completions.ChatCompletionTool[] = [
  {
    type: 'function',
    function: {
      name: 'search_documents',
      description:
        'Search Vietnamese legal documents by keyword, type, issuing body, or validity status. ' +
        'Use this first to find candidate documents before fetching their text. ' +
        'If validityStatus is omitted, prefer treating "Còn hiệu lực" (still in force) as the default ' +
        'expectation unless the user is clearly asking about historical or repealed law.',
      parameters: {
        type: 'object',
        properties: {
          keyword: { type: 'string', description: 'Free-text search term.' },
          searchScope: {
            type: 'string',
            enum: ['tieu-de', 'so-hieu', 'noi-dung'],
            description:
              '"tieu-de" (default) = title+citation, "so-hieu" = citation only, "noi-dung" = full text.',
          },
          documentTypes: {
            type: 'array',
            items: { type: 'string' },
            description:
              'e.g. ["Luật", "Nghị định"]. Must match vbpl.vn document type strings exactly.',
          },
          issuingBodies: {
            type: 'array',
            items: { type: 'string' },
            description: 'e.g. ["Chính phủ", "Quốc hội"].',
          },
          validityStatus: {
            type: 'string',
            description:
              'e.g. "Còn hiệu lực", "Hết hiệu lực toàn bộ". Omit to default to still-in-force.',
          },
          page: { type: 'integer', minimum: 1 },
          pageSize: { type: 'integer', minimum: 1, maximum: 50 },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_document',
      description:
        'Fetch metadata (dates, validity status, issuing body, source URL) for one document by its ID.',
      parameters: {
        type: 'object',
        properties: {
          documentId: { type: 'string', description: 'Document UUID.' },
        },
        required: ['documentId'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_document_nodes',
      description:
        'Fetch the Điều/Khoản/Điểm structure of a document. ' +
        'Omitting both nodeType+number and nodeId returns an outline only (labels/headings, no text) ' +
        'to avoid flooding context with an entire document’s text — call again with nodeType+number ' +
        '(e.g. nodeType="dieu", number="5") or nodeId to get the full text of one specific clause.',
      parameters: {
        type: 'object',
        properties: {
          documentId: { type: 'string', description: 'Document UUID.' },
          nodeType: { type: 'string', enum: NODE_TYPE_OPTIONS },
          number: {
            type: 'string',
            description:
              'Ordinal, e.g. "5" for Điều 5, "2" for Khoản 2, "a" for Điểm a. Used with nodeType.',
          },
          nodeId: {
            type: 'string',
            description: 'Node UUID, overrides nodeType+number.',
          },
        },
        required: ['documentId'],
      },
    },
  },
];

export async function dispatchToolCall(
  lawApi: LawApiClient,
  name: string,
  rawArgs: string,
): Promise<unknown> {
  const args = rawArgs ? (JSON.parse(rawArgs) as Record<string, unknown>) : {};

  switch (name) {
    case 'search_documents':
      return lawApi.search(args);
    case 'get_document':
      return lawApi.getById(args.documentId as string);
    case 'get_document_nodes': {
      const wantsText = Boolean(args.nodeId) || Boolean(args.nodeType);
      const result = await lawApi.getNodes({
        documentId: args.documentId as string,
        nodeType: args.nodeType as string | undefined,
        number: args.number as string | undefined,
        nodeId: args.nodeId as string | undefined,
      });
      if (wantsText) return result;
      return { ...result, nodes: result.nodes.map(toOutline) };
    }
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

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

/** Strips full text from a node tree, keeping only structure — see get_document_nodes's description. */
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
