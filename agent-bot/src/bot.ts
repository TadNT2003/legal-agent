import { Client, GatewayIntentBits, Partials } from 'discord.js';
import type { AgentService } from './agent/agentService.js';
import type { PgSessionStore } from './agent/pgSessionStore.js';
import { registerMessageCreateEvent } from './events/messageCreate.js';
import { registerReadyEvent } from './events/ready.js';

export function createBot(
  agentService: AgentService,
  sessionStore: PgSessionStore,
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

  return client;
}

export async function startBot(
  agentService: AgentService,
  sessionStore: PgSessionStore,
  token: string,
): Promise<Client> {
  const client = createBot(agentService, sessionStore);
  await client.login(token);
  return client;
}
