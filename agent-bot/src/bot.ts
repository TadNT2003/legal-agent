import { Client, GatewayIntentBits, Partials } from 'discord.js';
import { REST, Routes } from 'discord.js';
import type { AgentService } from './agent/agentService.js';
import type { PgSessionStore } from './agent/pgSessionStore.js';
import type { ReconnectingMcpClient } from './mcp/client.js';
import { config } from './config.js';
import { registerMessageCreateEvent } from './events/messageCreate.js';
import { registerButtonInteractions } from './events/buttonInteractions.js';
import { registerReadyEvent } from './events/ready.js';
import {
  getCommandBuilders,
  registerSlashCommands,
} from './commands/splashCommands.js';
import { createLogger } from './tools/logging.js';

const logger = createLogger('discord-bot');

export function createBot(
  agentService: AgentService,
  sessionStore: PgSessionStore,
  mcpClient: ReconnectingMcpClient,
): Client {
  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
      GatewayIntentBits.DirectMessages,
    ],
    partials: [Partials.Channel],
  });

  registerReadyEvent(client);
  registerMessageCreateEvent(client, agentService, sessionStore);
  registerButtonInteractions(client, agentService, sessionStore);
  registerSlashCommands(client, mcpClient, sessionStore);

  client.once('ready', () => {
    void registerGlobalCommands(client);
  });

  return client;
}

async function registerGlobalCommands(client: Client): Promise<void> {
  const commands = getCommandBuilders();
  const clientId = client.user?.id;
  if (!clientId) return;

  const rest = new REST({ version: '10' }).setToken(config.discord.token);

  try {
    logger.log('Started refreshing global application (/) commands.');
    await rest.put(Routes.applicationCommands(clientId), {
      body: [...commands.values()].map((cmd) => cmd.toJSON()),
    });
    logger.log('Successfully reloaded global application (/) commands.');
  } catch (error) {
    logger.error('Failed to register slash commands:', error);
  }
}

export async function startBot(
  agentService: AgentService,
  sessionStore: PgSessionStore,
  mcpClient: ReconnectingMcpClient,
  token: string,
): Promise<Client> {
  const client = createBot(agentService, sessionStore, mcpClient);
  await client.login(token);
  return client;
}