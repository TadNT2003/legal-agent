import type { Client, Message } from 'discord.js';
import { ChannelType, Events } from 'discord.js';
import type { AgentService } from '../agent/agentService.js';
import { createLogger } from '../tools/logging.js';

const logger = createLogger('discord-message');
const DISCORD_MESSAGE_LIMIT = 2000;

/**
 * Skeleton PoC bot: responds only when @mentioned in a guild channel or
 * DM'd directly. No slash-command registration, no conversation memory —
 * each message is a fresh, stateless question passed to AgentService.
 */
export function registerMessageCreateEvent(
  client: Client,
  agentService: AgentService,
): void {
  client.on(Events.MessageCreate, (message) => {
    void handleMessage(client, agentService, message);
  });
}

async function handleMessage(
  client: Client,
  agentService: AgentService,
  message: Message,
): Promise<void> {
  if (message.author.bot) return;
  if (!client.user) return;

  const isDm = message.channel.type === ChannelType.DM;
  const isMentioned = message.mentions.has(client.user);
  if (!isDm && !isMentioned) return;

  const question = message.content
    .replace(new RegExp(`<@!?${client.user.id}>`, 'g'), '')
    .trim();
  if (!question) return;

  if ('sendTyping' in message.channel) {
    await message.channel.sendTyping();
  }

  let reply: string;
  try {
    reply = await agentService.chat(question);
  } catch (error) {
    logger.error('AgentService.chat failed', error);
    reply =
      'Xin lỗi, đã có lỗi xảy ra khi xử lý câu hỏi. Vui lòng thử lại sau.';
  }

  for (const chunk of splitMessage(reply)) {
    await message.reply(chunk);
  }
}

function splitMessage(text: string): string[] {
  if (text.length <= DISCORD_MESSAGE_LIMIT) return [text || '(no answer)'];

  const chunks: string[] = [];
  let remaining = text;
  while (remaining.length > 0) {
    chunks.push(remaining.slice(0, DISCORD_MESSAGE_LIMIT));
    remaining = remaining.slice(DISCORD_MESSAGE_LIMIT);
  }
  return chunks;
}
