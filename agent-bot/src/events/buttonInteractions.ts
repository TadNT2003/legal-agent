import type {
  Interaction,
  Client as DiscordClient,
} from 'discord.js';
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, Events } from 'discord.js';
import type { AgentService } from '../agent/agentService.js';
import type { Session } from '../agent/sessionStore.js';
import type { PgSessionStore } from '../agent/pgSessionStore.js';
import { createLogger } from '../tools/logging.js';
import {
  extractSources,
  sourcesToCitationLines,
} from './sourceExtraction.js';

const logger = createLogger('button-interactions');

const BUTTON_FOLLOW_UP = 'follow_up';
const BUTTON_DETAILS = 'details';
const BUTTON_END = 'end_session';

export function createFollowUpRow(sessionId: string): ActionRowBuilder {
  const row = new ActionRowBuilder();
  row.addComponents(
    new ButtonBuilder()
      .setCustomId(`${BUTTON_FOLLOW_UP}:${sessionId}`)
      .setLabel('Tra c\u1ee9u th\u00eam')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(`${BUTTON_DETAILS}:${sessionId}`)
      .setLabel('Chi ti\u1ebft')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`${BUTTON_END}:${sessionId}`)
      .setLabel('K\u1ebft th\u00fac')
      .setStyle(ButtonStyle.Danger),
  );
  return row;
}

export function registerButtonInteractions(
  client: DiscordClient,
  agentService: AgentService,
  sessionStore: PgSessionStore,
): void {
  client.on(Events.InteractionCreate, (interaction) => {
    void handleButtonInteraction(interaction, client, agentService, sessionStore);
  });
}

async function handleButtonInteraction(
  interaction: Interaction,
  _client: DiscordClient,
  agentService: AgentService,
  sessionStore: PgSessionStore,
): Promise<void> {
  if (!interaction.isButton()) return;

  const customId = interaction.customId;
  const colonIndex = customId.indexOf(':');
  if (colonIndex === -1) return;

  const action = customId.slice(0, colonIndex);
  const sessionId = customId.slice(colonIndex + 1);

  if (!sessionId) {
    logger.error('Button interaction missing session ID');
    return;
  }

  const session = await sessionStore.getById(sessionId);

  switch (action) {
    case BUTTON_FOLLOW_UP: {
      if (!session) {
        await interaction.reply({
          content: 'Phi\u1ec1n h\u1ed9i tho\u1ea1i kh\u00f4n c\u00f2n h\u1ec1 th\u1ed1ng. Vui l\u1ed3ng b\u1eaft \u0111\u1ea7u phi\u1ec1n m\u1edbi.',
          ephemeral: true,
        });
        return;
      }
      await interaction.reply({
        content: `G\u1eedi c\u00e2u h\u1edfi ti\u1ebfp theo c\u1ee7a b\u1ea1n. B\u1ea1n c\u0169ng c\u00f3 th\u1ec3 tr\u1ea3 l\u1ed3i tin nh\u1eadn c\u1ee7a bot \u0111\u1ec3 ti\u1ebfp t\u1ee5c h\u1ed9i tho\u1ea1i.`,
        ephemeral: true,
      });
      break;
    }

    case BUTTON_DETAILS: {
      if (!session) {
        await interaction.reply({
          content: 'Phi\u1ec1n h\u1ed9i tho\u1ea1i kh\u00f4n c\u00f2n h\u1ec1 th\u1ed1ng.',
          ephemeral: true,
        });
        return;
      }
      const citations = extractCitations(session.messages);
      if (citations.length === 0) {
        await interaction.reply({
          content: 'Kh\u00f4ng t\u00ecm th\u1ea5y ng\u00f4n t\u00e0i nguy\u00ean n\u00e0o \u0111\u01b0\u1ee3c s\u1eed d\u1ee5ng trong phi\u1ec1n n\u00e0y.',
          ephemeral: true,
        });
        return;
      }
      const embed = new EmbedBuilder()
        .setTitle('\ud83d\udcda Ng\u00f4n t\u00e0i nguy\u00ean')
        .setColor(0x0099ff)
        .setDescription(citations.join('\n\n'))
        .setFooter({ text: `T\u1ed5ng c\u1ed9ng: ${citations.length} ng\u00f4n t\u00e0i` })
        .setTimestamp();

      if (embed.data.description && embed.data.description.length > 4096) {
        embed.setDescription(
          embed.data.description?.slice(0, 4093) + '...',
        );
      }

      await interaction.reply({ embeds: [embed], ephemeral: true });
      break;
    }

    case BUTTON_END: {
      if (!session) {
        await interaction.reply({
          content: 'Phi\u1ec1n h\u1ed9i tho\u1ea1i \u0111\u00e3 k\u1ebft th\u00fac.',
          ephemeral: true,
        });
        return;
      }
      await interaction.reply({
        content: 'Phi\u1ec1n h\u1ed9i tho\u1ea1i \u0111\u00e3 \u0111\u01b0\u1ee3c k\u1ebft th\u00fac. Vui l\u1ed3ng nh\u00e1c @bot ho\u1eb7c g\u1eedi DM \u0111\u1ec3 b\u1eaft \u0111\u1ea7u phi\u1ec1n m\u1edbi.',
        ephemeral: true,
      });
      break;
    }

    default:
      logger.error(`Unknown button action: ${action}`);
  }
}

export function extractCitations(messages: Session['messages']): string[] {
  // Delegate to the shared extractor (also used by /sources) so the real
  // search_documents shape (items[] with sourceUrl) is handled, then render
  // back to the "title — citation" lines this button has always shown.
  const structured = extractSources(messages);
  if (structured.length > 0) {
    return sourcesToCitationLines(structured);
  }

  // Fallback for the rare case where a tool result was a short non-JSON string
  // (an error message, etc.) — surface it verbatim rather than nothing.
  const citations: string[] = [];
  const seen = new Set<string>();
  for (const msg of messages) {
    if (msg.role !== 'tool' || typeof msg.content !== 'string') continue;
    try {
      JSON.parse(msg.content);
    } catch {
      const text = msg.content;
      if (text.length < 500 && !seen.has(text)) {
        seen.add(text);
        citations.push(text);
      }
    }
  }
  return citations;
}