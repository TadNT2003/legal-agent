import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import type {
  CallToolResult,
  Tool,
} from '@modelcontextprotocol/sdk/types.js';
import type OpenAI from 'openai';

/**
 * MCP's tools/list already describes each tool's inputSchema as plain JSON
 * Schema — the same shape OpenAI's `function.parameters` expects — so this
 * adapter is a reshape, not a translation. Fetched once at startup, not
 * per chat() call, since legal-mcp's tool list is static for a given
 * deployment.
 */
export function toOpenAiTools(
  tools: Tool[],
): OpenAI.Chat.Completions.ChatCompletionTool[] {
  return tools.map((tool) => ({
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.inputSchema,
    },
  }));
}

export async function listOpenAiTools(
  client: Client,
): Promise<OpenAI.Chat.Completions.ChatCompletionTool[]> {
  const { tools } = await client.listTools();
  return toOpenAiTools(tools);
}

/**
 * Checks if an error is transient and worth retrying (network, timeout).
 * Distinct from MCP-level isError results — this only covers transport failures.
 */
function isTransientError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const msg = error.message.toLowerCase();
  return (
    msg.includes('econnrefused') ||
    msg.includes('econnreset') ||
    msg.includes('etimedout') ||
    msg.includes('fetch failed') ||
    msg.includes('network')
  );
}

/**
 * Executes one tool call via MCP and returns the text to feed back into the
 * OpenAI-shaped tool-calling loop. legal-mcp's tools each return exactly one
 * text content block containing pre-serialized JSON — unwrap it directly
 * rather than re-stringifying the whole MCP content envelope.
 *
 * On transient transport errors (network, timeout), retries once after a
 * short backoff before surfacing the error to the agent loop.
 */
export async function callMcpTool(
  client: Client,
  name: string,
  rawArgs: string,
): Promise<string> {
  const args = rawArgs
    ? (JSON.parse(rawArgs) as Record<string, unknown>)
    : {};

  const doCall = async (): Promise<string> => {
    const result = (await client.callTool({
      name,
      arguments: args,
    })) as CallToolResult;
    const block = result.content?.[0];
    const text =
      block && block.type === 'text' ? block.text : JSON.stringify(result);

    if (result.isError) {
      throw new Error(text);
    }
    return text;
  };

  try {
    return await doCall();
  } catch (error) {
    if (isTransientError(error)) {
      await sleep(500);
      return await doCall();
    }
    throw error;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Fetches an MCP prompt's first message text — used for legal_lookup_guidance. */
export async function fetchPromptText(
  client: Client,
  promptName: string,
): Promise<string> {
  const result = await client.getPrompt({ name: promptName });
  const message = result.messages[0];
  if (message?.content.type === 'text') {
    return message.content.text;
  }
  throw new Error(`Prompt "${promptName}" did not return text content`);
}
