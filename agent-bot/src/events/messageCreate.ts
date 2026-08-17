import type { Client, DMChannel, Message } from 'discord.js';
import { ChannelType, EmbedBuilder, Events } from 'discord.js';
import type {
  AgentService,
  StreamEvent,
} from '../agent/agentService.js';
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions.js';
import type { Session } from '../agent/sessionStore.js';
import type { PgSessionStore } from '../agent/pgSessionStore.js';
import { createFollowUpRow, extractCitations } from './buttonInteractions.js';
import { createLogger } from '../tools/logging.js';
import { createRateLimiter } from '../utils/rateLimiter.js';

const logger = createLogger('discord-message');
const DISCORD_MESSAGE_LIMIT = 2000;
const TRIGGER_KEYWORD = 'harpae';
const STREAM_EDIT_INTERVAL_MS = 1500;
const STREAM_EDIT_MIN_CHARS = 80;
const EMBED_MAX_DESCRIPTION = 4096;
const EMBED_MAX_FIELD_VALUE = 1024;
const EMBED_COLOR = 0x5865F2;

const activeRequests = new Map<string, AbortController>();
const rateLimiter = createRateLimiter({
  maxRequests: 10,
  windowMs: 60_000,
});

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
  const requestKey = message.author.id;

  const rateResult = rateLimiter.check(requestKey);
  if (!rateResult.allowed) {
    const waitSeconds = Math.ceil((rateResult.resetAt - Date.now()) / 1000);
    await message.reply(`⚠️ Bạn gửi quá nhiều yêu cầu. Vui lòng thử lại sau ${waitSeconds} giây.`);
    return;
  }

  if (activeRequests.has(requestKey)) {
    activeRequests.get(requestKey)?.abort();
  }

  const controller = new AbortController();
  activeRequests.set(requestKey, controller);

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
    }, controller.signal);
    await sessionStore.update(session, result.messages);
  } catch (error) {
    if (controller.signal.aborted) {
      await initialMsg.edit('⛔ Yêu cầu đã bị hủy.');
      clearInterval(typingInterval);
      activeRequests.delete(requestKey);
      return;
    }
    logger.error('AgentService.chatStream failed', error);
    const errorEmbed = new EmbedBuilder()
      .setColor(0xED4245)
      .setDescription('Xin lỗi, đã có lỗi xảy ra khi xử lý câu hỏi. Vui lòng thử lại sau.')
      .setTimestamp();
    await initialMsg.edit({ embeds: [errorEmbed] });
    return;
  } finally {
    clearInterval(typingInterval);
    activeRequests.delete(requestKey);
  }

  await sendStreamingReply(initialMsg, result.reply, session, result.messages, message, sessionStore);
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
    const embed = buildAnswerEmbed(content);
    await msg.edit({ embeds: [embed] });
  } catch {
    // Message may no longer be editable; ignore.
  }
}

function buildAnswerEmbed(
  answer: string,
  citations?: string[],
): EmbedBuilder {
  const embed = new EmbedBuilder();
  embed.setColor(EMBED_COLOR);

  const truncated =
    answer.length > EMBED_MAX_DESCRIPTION
      ? answer.slice(0, EMBED_MAX_DESCRIPTION - 3) + '...'
      : answer;
  embed.setDescription(truncated || '(no answer)');

  if (citations && citations.length > 0) {
    const sources = citations.join('\n');
    const sourcesText =
      sources.length > EMBED_MAX_FIELD_VALUE
        ? sources.slice(0, EMBED_MAX_FIELD_VALUE - 3) + '...'
        : sources;
    embed.addFields({
      name: '📚 Nguồn',
      value: sourcesText,
      inline: false,
    });
  }

  embed.setTimestamp();
  return embed;
}

async function sendStreamingReply(
  initialMsg: Message,
  reply: string,
  session: Session,
  messages: ChatCompletionMessageParam[],
  originalMessage: Message,
  store: PgSessionStore,
): Promise<void> {
  const citations = extractCitations(messages);
  const body = reply || '(no answer)';

  if (body.length <= DISCORD_MESSAGE_LIMIT) {
    const embed = buildAnswerEmbed(body, citations);
    try {
      await initialMsg.edit({
        embeds: [embed],
        components: [createFollowUpRow(session.id).toJSON()],
      });
      store.linkReplyTarget(initialMsg.id, session);
    } catch {
      await originalMessage.reply({
        embeds: [embed],
        components: [createFollowUpRow(session.id).toJSON()],
      });
    }
  } else {
    const chunks = splitMessage(body);
    const firstEmbed = buildAnswerEmbed(chunks[0], citations);
    try {
      await initialMsg.edit({
        embeds: [firstEmbed],
      });
      store.linkReplyTarget(initialMsg.id, session);
    } catch {
      await originalMessage.reply({ embeds: [firstEmbed] });
    }
    for (let i = 1; i < chunks.length; i++) {
      const isLast = i === chunks.length - 1;
      const chunkEmbed = buildAnswerEmbed(chunks[i]);
      const sent = isLast
        ? await originalMessage.reply({ embeds: [chunkEmbed], components: [createFollowUpRow(session.id).toJSON()] })
        : await originalMessage.reply({ embeds: [chunkEmbed] });
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
