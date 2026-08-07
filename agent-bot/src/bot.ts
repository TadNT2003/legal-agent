import { Client, GatewayIntentBits, Partials } from 'discord.js';
import type { AgentService } from './agent/agentService.js';
import { config } from './config.js';
import { registerMessageCreateEvent } from './events/messageCreate.js';
import { registerReadyEvent } from './events/ready.js';

export function createBot(agentService: AgentService): Client {
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
  registerMessageCreateEvent(client, agentService);

  return client;
}

export async function startBot(agentService: AgentService): Promise<Client> {
  const client = createBot(agentService);
  await client.login(config.discord.token);
  return client;
}
