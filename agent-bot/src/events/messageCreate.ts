import type { Client, DMChannel, Message } from 'discord.js';
import { ChannelType, Events } from 'discord.js';
import type {
  AgentService,
  StreamEvent,
} from '../agent/agentService.js';
import type { Session } from '../agent/sessionStore.js';
import type { PgSessionStore } from '../agent/pgSessionStore.js';
import { createFollowUpRow } from './buttonInteractions.js';
import { createLogger } from '../tools/logging.js';

const logger = createLogger('discord-message');
const DISCORD_MESSAGE_LIMIT = 2000;
const TRIGGER_KEYWORD = 'harpae';
const STREAM_EDIT_INTERVAL_MS = 1500;
const STREAM_EDIT_MIN_CHARS = 80;

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
  sessionStore: PgSessionStore,
): void {
  client.on(Events.MessageCreate, (message) => {
    void handleMessage(client, agentService, sessionStore, message);
  });
}

function resolveUserId(message: Message): string | undefined {
  if (message.channel.type === ChannelType.DM) {
    return (message.channel as DMChannel).recipientId;
  }
  return message.author.id;
}

function resolveChannelId(message: Message): string | undefined {
  return message.channelId;
}

async function handleMessage(
  client: Client,
  agentService: AgentService,
  sessionStore: PgSessionStore,
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

  const userId = resolveUserId(message);
  const channelId = resolveChannelId(message);

  let session: Session;
  if (startsNewSession) {
    session = sessionStore.createSession(userId, channelId);
  } else {
    const isReplyToBot = await isReplyToBotMessage(client, message);
    if (!isReplyToBot) return;

    const replyTargetId = message.reference?.messageId;
    const existing = replyTargetId
      ? await sessionStore.getByReplyTarget(replyTargetId)
      : undefined;
    // Fallback: session not tracked (e.g. process restarted since) — still
    // answer, just without prior context, instead of ignoring the message.
    session = existing ?? sessionStore.createSession(userId, channelId);
  }

  const question = message.content
    .replace(new RegExp(`<@!?${client.user.id}>`, 'g'), '')
    .trim();
  if (!question) return;

  if ('sendTyping' in message.channel) {
    await message.channel.sendTyping();
  }

  const typingInterval = startTypingInterval(message.channel);
  const initialMsg = await message.reply('⏳ Đang tra cứu...');

  let streamAccumulator = '';
  let streamLastEdit = 0;
  const streamEditState = {
    get accumulated() { return streamAccumulator; },
    set accumulated(v: string) { streamAccumulator = v; },
    get lastEdit() { return streamLastEdit; },
    set lastEdit(v: number) { streamLastEdit = v; },
  };

  let result;
  try {
    result = await agentService.chatStream(session.messages, question, (event) => {
      handleStreamEvent(event, message.channel, initialMsg, streamEditState);
    });
    await sessionStore.update(session, result.messages);
  } catch (error) {
    logger.error('AgentService.chatStream failed', error);
    result = {
      reply: 'Xin lỗi, đã có lỗi xảy ra khi xử lý câu hỏi. Vui lòng thử lại sau.',
      messages: session.messages,
    };
    await initialMsg.edit('Xin lỗi, đã có lỗi xảy ra khi xử lý câu hỏi. Vui lòng thử lại sau.');
  } finally {
    clearInterval(typingInterval);
  }

  await sendStreamingReply(initialMsg, result.reply, session, message, sessionStore);
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

const TYPING_INTERVAL_MS = 10000;

async function sendTyping(channel: Message['channel']): Promise<void> {
  if ('sendTyping' in channel) {
    try {
      await channel.sendTyping();
    } catch {
      // sendTyping can fail if the channel is no longer available; ignore.
    }
  }
}

function startTypingInterval(channel: Message['channel']): ReturnType<typeof setInterval> {
  return setInterval(() => {
    void sendTyping(channel);
  }, TYPING_INTERVAL_MS);
}

interface StreamEditState {
  accumulated: string;
  lastEdit: number;
}

function handleStreamEvent(
  event: StreamEvent,
  channel: Message['channel'],
  initialMsg: Message,
  state: StreamEditState,
): void {
  if (event.type === 'token') {
    state.accumulated += event.text;
    const now = Date.now();
    if (now - state.lastEdit >= STREAM_EDIT_INTERVAL_MS &&
        state.accumulated.length >= STREAM_EDIT_MIN_CHARS) {
      state.lastEdit = now;
      void attemptEditReply(initialMsg, state.accumulated);
    }
    void sendTyping(channel);
  } else if (event.type === 'round_start' || event.type === 'tool') {
    void sendTyping(channel);
  }
}

async function attemptEditReply(msg: Message, content: string): Promise<void> {
  try {
    if (content.length <= DISCORD_MESSAGE_LIMIT) {
      await msg.edit(content);
    } else {
      await msg.edit(content.slice(0, DISCORD_MESSAGE_LIMIT));
    }
  } catch {
    // Message may no longer be editable; ignore.
  }
}

async function sendStreamingReply(
  initialMsg: Message,
  reply: string,
  session: Session,
  originalMessage: Message,
  store: PgSessionStore,
): Promise<void> {
  if (reply.length <= DISCORD_MESSAGE_LIMIT) {
    try {
      await initialMsg.edit({
        content: reply || '(no answer)',
        components: [createFollowUpRow(session.id).toJSON()],
      });
      store.linkReplyTarget(initialMsg.id, session);
    } catch {
      await originalMessage.reply({
        content: reply || '(no answer)',
        components: [createFollowUpRow(session.id).toJSON()],
      });
    }
  } else {
    const chunks = splitMessage(reply);
    try {
      await initialMsg.edit({
        content: chunks[0],
      });
      store.linkReplyTarget(initialMsg.id, session);
    } catch {
      await originalMessage.reply(chunks[0]);
    }
    for (let i = 1; i < chunks.length; i++) {
      const isLast = i === chunks.length - 1;
      const sent = isLast
        ? await originalMessage.reply({ content: chunks[i], components: [createFollowUpRow(session.id).toJSON()] })
        : await originalMessage.reply(chunks[i]);
      store.linkReplyTarget(sent.id, session);
    }
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
