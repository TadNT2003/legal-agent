import type { Client } from 'discord.js';
import { Events } from 'discord.js';
import { createLogger } from '../tools/logging.js';

const logger = createLogger('discord-ready');

export function registerReadyEvent(client: Client): void {
  client.once(Events.ClientReady, (readyClient) => {
    logger.log(`Logged in as ${readyClient.user.tag}`);
  });
}
