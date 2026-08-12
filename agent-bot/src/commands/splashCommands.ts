import type { ChatInputCommandInteraction, Client, Interaction } from 'discord.js';
import {
  SlashCommandBuilder,
  EmbedBuilder,
  Events,
  Collection,
} from 'discord.js';

const commands: SlashCommandBuilder[] = [
  new SlashCommandBuilder()
    .setName('help')
    .setDescription('Hiển thị các lệnh và cách sử dụng trợ lý pháp luật'),

  new SlashCommandBuilder()
    .setName('about')
    .setDescription('Thông tin về trợ lý pháp luật'),

  new SlashCommandBuilder()
    .setName('status')
    .setDescription('Kiểm tra trạng thái bot'),
];

const commandBuilders = new Collection<string, SlashCommandBuilder>(
  commands.map((cmd) => [cmd.name, cmd]),
);

type CmdHandler = (
  interaction: ChatInputCommandInteraction,
  client: Client,
) => Promise<void>;

const handlers = new Collection<string, CmdHandler>([
  ['help', helpHandler],
  ['about', aboutHandler],
  ['status', statusHandler],
]);

export function registerSlashCommands(client: Client): void {
  client.on(Events.InteractionCreate, (interaction) => {
    void handleInteraction(interaction, client);
  });
}

async function handleInteraction(
  interaction: Interaction,
  client: Client,
): Promise<void> {
  if (!interaction.isChatInputCommand()) return;
  if (!interaction.isChatInputCommand()) return;

  const handler = handlers.get(interaction.commandName);
  if (!handler) return;

  try {
    await handler(interaction, client);
  } catch (error) {
    console.error(`Error executing ${interaction.commandName}:`, error);
    await interaction.reply({
      content: 'Xin lỗi, đã có lỗi xảy ra khi xử lý lệnh.',
      ephemeral: true,
    });
  }
}

export function getCommandBuilders(): Collection<string, SlashCommandBuilder> {
  return commandBuilders;
}

async function helpHandler(
  interaction: ChatInputCommandInteraction,
  _client: Client,
): Promise<void> {
  const embed = new EmbedBuilder()
    .setTitle('📖 Trợ Lý Pháp Luật — Hướng Dẫn Sử Dụng')
    .setColor(0x0099ff)
    .addFields(
      {
        name: 'Các Lệnh Lưỡi Dao (Slash Commands)',
        value:
          '`/help` — Hiển thị hướng dẫn này\n' +
          '`/about` — Thông tin về trợ lý\n' +
          '`/status` — Kiểm tra trạng thái bot',
      },
      {
        name: 'Cách Hỏi Bằng Tin Nhắn Thường',
        value:
          '— Gửi tin nhắn DM cho bot\n' +
          '— Nhắc `@HarpaeBot` kèm câu hỏi trong kênh\n' +
          '— Gõ từ `harpae` trong tin nhắn\n' +
          '— Trả lời tin nhắn của bot để tiếp tục cuộc hội thoại',
      },
      {
        name: 'Ví Dụ Câu Hỏi',
        value:
          '`Điều khoản nào về giải lao trong Bộ luật lao động?`\n' +
          '`Hồ sơ đăng ký doanh nghiệp cần những gì?`\n' +
          '`Mức phạt vượt tốc độ 10km/h là bao nhiêu?`',
      },
      {
        name: '⚠️ Miễn Trừ Trách Nhiệm',
        value:
          'Trợ lý này chỉ hỗ trợ tra cứu văn bản pháp luật, không thay thế tư vấn luật sư chuyên nghiệp.',
      },
    )
    .setFooter({
      text: 'Trợ Lý Pháp Luật Việt Nam',
    })
    .setTimestamp();

  await interaction.reply({ embeds: [embed] });
}

async function aboutHandler(
  interaction: ChatInputCommandInteraction,
  _client: Client,
): Promise<void> {
  const embed = new EmbedBuilder()
    .setTitle('ℹ️ Về Trợ Lý Pháp Luật')
    .setColor(0x0099ff)
    .setDescription(
      'Trợ lý tra cứu văn bản pháp luật Việt Nam, được trang bị khả năng tra cứu các văn bản pháp lý thông qua công cụ MCP.',
    )
    .addFields(
      {
        name: 'Chức Năng',
        value:
          '• Tra cứu văn bản pháp luật Việt Nam\n' +
          '• Tìm kiếm theo từ khóa, điều khoản\n' +
          '• Trả lời câu hỏi pháp lý dựa trên văn bản thực tế',
      },
      {
        name: 'Công Nghệ',
        value:
          '• AI với khả năng gọi công cụ (tool-calling)\n' +
          '• Kết nối MCP (Model Context Protocol)\n' +
          '• Lưu trữ hội thoại qua Postgres',
      },
      {
        name: '⚠️ Miễn Trừ Trách Nhiệm',
        value:
          'Thông tin trả về chỉ mang tính chất tra cứu, tham khảo. Trợ lý không thay thế ý kiến của luật sư chuyên nghiệp. Vui lòng kiểm tra lại với văn bản pháp luật chính thức.',
      },
    )
    .setFooter({
      text: 'legal-agent v0.0.1',
    })
    .setTimestamp();

  await interaction.reply({ embeds: [embed] });
}

async function statusHandler(
  interaction: ChatInputCommandInteraction,
  client: Client,
): Promise<void> {
  const uptime = getUptimeString(client.uptime);
  const guildCount = client.guilds.cache.size;
  const memberCount = client.guilds.cache.reduce(
    (acc, g) => acc + (g.memberCount || 0),
    0,
  );

  const embed = new EmbedBuilder()
    .setTitle('🟢 Trạng Thái Bot')
    .setColor(0x00ff00)
    .addFields(
      {
        name: 'Thời Gian Hoạt Động',
        value: uptime,
        inline: true,
      },
      {
        name: 'Server',
        value: String(guildCount),
        inline: true,
      },
      {
        name: 'Thành Viên',
        value: String(memberCount),
        inline: true,
      },
      {
        name: 'Trạng Thái',
        value: '✅ Hoạt động bình thường',
        inline: false,
      },
    )
    .setFooter({
      text: `Ping: ${client.ws.ping}ms`,
    })
    .setTimestamp();

  await interaction.reply({ embeds: [embed], ephemeral: true });
}

function getUptimeString(uptime: number | null | undefined): string {
  if (!uptime) return 'Không xác định';

  const seconds = Math.floor(uptime / 1000);
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;

  const parts: string[] = [];
  if (days > 0) parts.push(`${days} ngày`);
  if (hours > 0) parts.push(`${hours} giờ`);
  if (minutes > 0) parts.push(`${minutes} phút`);
  if (secs > 0 || parts.length === 0) parts.push(`${secs} giây`);

  return parts.join(', ');
}