import type { Client, Message } from 'discord.js';
import { ChannelType, Events } from 'discord.js';
import type { AgentService } from '../agent/agentService.js';
import type { Session, SessionStore } from '../agent/sessionStore.js';
import { createLogger } from '../tools/logging.js';

const logger = createLogger('discord-message');
const DISCORD_MESSAGE_LIMIT = 2000;
const TRIGGER_KEYWORD = 'harpae';

/**
 * Skeleton PoC bot: responds on DM, @mention, the bare word "harpae"
 * (case-insensitive, anywhere in the message), or a reply to one of its own
 * messages.
 *
 * Conversation memory: a mention/keyword/DM trigger always starts a NEW
 * session (fresh context, no prior turns). Replying to one of the bot's own
 * messages continues *that message's* session instead — the whole
 * question/answer history from that session is fed back to the LLM, and the
 * new turn is appended to it. Replying to a message the store no longer
 * recognizes (not a bot message, or a session lost to a restart) falls back
 * to starting a fresh session rather than going silent.
 */
export function registerMessageCreateEvent(
  client: Client,
  agentService: AgentService,
  sessionStore: SessionStore,
): void {
  client.on(Events.MessageCreate, (message) => {
    void handleMessage(client, agentService, sessionStore, message);
  });
}

async function handleMessage(
  client: Client,
  agentService: AgentService,
  sessionStore: SessionStore,
  message: Message,
): Promise<void> {
  if (message.author.bot) return;
  if (!client.user) return;

  const isDm = message.channel.type === ChannelType.DM;
  const isMentioned = message.mentions.has(client.user);
  const containsKeyword = message.content
    .toLowerCase()
    .includes(TRIGGER_KEYWORD);
  const startsNewSession = isDm || isMentioned || containsKeyword;

  let session: Session;
  if (startsNewSession) {
    session = sessionStore.createSession();
  } else {
    const isReplyToBot = await isReplyToBotMessage(client, message);
    if (!isReplyToBot) return;

    const replyTargetId = message.reference?.messageId;
    const existing = replyTargetId
      ? sessionStore.getByReplyTarget(replyTargetId)
      : undefined;
    // Fallback: session not tracked (e.g. process restarted since) — still
    // answer, just without prior context, instead of ignoring the message.
    session = existing ?? sessionStore.createSession();
  }

  const question = message.content
    .replace(new RegExp(`<@!?${client.user.id}>`, 'g'), '')
    .trim();
  if (!question) return;

  if ('sendTyping' in message.channel) {
    await message.channel.sendTyping();
  }

  let reply: string;
  try {
    const result = await agentService.chat(session.messages, question);
    reply = result.reply;
    sessionStore.update(session, result.messages);
  } catch (error) {
    logger.error('AgentService.chat failed', error);
    reply =
      'Xin lỗi, đã có lỗi xảy ra khi xử lý câu hỏi. Vui lòng thử lại sau.';
  }

  for (const chunk of splitMessage(reply)) {
    const sent = await message.reply(chunk);
    sessionStore.linkReplyTarget(sent.id, session);
  }
}

/** True if `message` is a reply, and the replied-to message was authored by the bot. */
async function isReplyToBotMessage(
  client: Client,
  message: Message,
): Promise<boolean> {
  if (!message.reference) return false;
  if (!client.user) return false;

  // Fast path: Discord includes the referenced message inline on most
  // replies, and discord.js exposes its author here with no extra API call.
  if (message.mentions.repliedUser) {
    return message.mentions.repliedUser.id === client.user.id;
  }

  // Fallback: not included inline (e.g. an older/uncached message) — fetch it.
  try {
    const referenced = await message.fetchReference();
    return referenced.author.id === client.user.id;
  } catch (error) {
    logger.error('Failed to fetch replied-to message', error);
    return false;
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
