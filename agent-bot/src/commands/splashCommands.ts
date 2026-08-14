import type {
  ChatInputCommandInteraction,
  Interaction,
  Client as DiscordClient,
} from 'discord.js';
import {
  SlashCommandBuilder,
  EmbedBuilder,
  Events,
  Collection,
} from 'discord.js';
import type { ReconnectingMcpClient } from '../mcp/client.js';
import { createLogger } from '../tools/logging.js';

const logger = createLogger('splash-commands');

const DISCORD_EMBED_DESC_LIMIT = 4096;
const DISCORD_FIELD_VALUE_LIMIT = 1024;
const MAX_SEARCH_RESULTS = 5;

interface LegalDocument {
  id?: string;
  title?: string;
  tieuDe?: string;
  soHieu?: string;
  citation?: string;
  documentType?: string;
  hinhThuc?: string;
  issuingBody?: string;
  coQuanBanHanh?: string;
  effectiveDate?: string;
  ngayBanHanh?: string;
  validityStatus?: string;
  trangThaiHieuLuc?: string;
}

interface SearchResponse {
  documents?: LegalDocument[];
  results?: LegalDocument[];
  total?: number;
  totalCount?: number;
  totalResults?: number;
}

const searchCommand = new SlashCommandBuilder()
  .setName('search')
  .setDescription('Tìm kiếm văn bản pháp luật Việt Nam')
  .addStringOption((option) =>
    option
      .setName('keyword')
      .setDescription('Từ khóa tìm kiếm')
      .setRequired(true),
  )
  .addStringOption((option) =>
    option
      .setName('phạm-vi')
      .setDescription('Phạm vi tìm kiếm')
      .setRequired(false)
      .addChoices(
        { name: 'Tiêu đề + Số hiệu', value: 'tieu-de' },
        { name: 'Số hiệu', value: 'so-hieu' },
        { name: 'Nội dung', value: 'noi-dung' },
      ),
  )
  .addStringOption((option) =>
    option
      .setName('loai-van-ban')
      .setDescription('Loại văn bản (cách nhau bởi dấu phẩy)')
      .setRequired(false)
      .setMaxLength(256),
  )
  .addStringOption((option) =>
    option
      .setName('co-quan')
      .setDescription('Cơ quan ban hành (cách nhau bởi dấu phẩy)')
      .setRequired(false)
      .setMaxLength(256),
  )
  .addStringOption((option) =>
    option
      .setName('hieu-luc')
      .setDescription('Trạng thái hiệu lực')
      .setRequired(false)
      .addChoices(
        { name: 'Còn hiệu lực', value: 'Còn hiệu lực' },
        { name: 'Chưa có hiệu lực', value: 'Chưa có hiệu lực' },
        { name: 'Hết hiệu lực toàn bộ', value: 'Hết hiệu lực toàn bộ' },
        { name: 'Hết hiệu lực một phần', value: 'Hết hiệu lực một phần' },
        { name: 'Ngưng hiệu lực', value: 'Ngưng hiệu lực' },
        { name: 'Tất cả (bao gồm lịch sử)', value: 'all' },
      ),
  )
  .addIntegerOption((option) =>
    option
      .setName('so-ket-qua')
      .setDescription('Số kết quả tối đa (1-50, mặc định 5)')
      .setRequired(false)
      .setMinValue(1)
      .setMaxValue(50),
  );

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

  searchCommand as unknown as SlashCommandBuilder,
];

const commandBuilders = new Collection<string, SlashCommandBuilder>(
  commands.map((cmd) => [cmd.name, cmd]),
);

type CmdHandler = (
  interaction: ChatInputCommandInteraction,
  client: DiscordClient,
  mcpClient: ReconnectingMcpClient,
) => Promise<void>;

let mcpClientRef: ReconnectingMcpClient | undefined;

const handlers = new Collection<string, CmdHandler>([
  ['help', helpHandler],
  ['about', aboutHandler],
  ['status', statusHandler],
  ['search', searchHandler],
]);

export function registerSlashCommands(
  client: DiscordClient,
  mcpClient: ReconnectingMcpClient,
): void {
  mcpClientRef = mcpClient;

  client.on(Events.InteractionCreate, (interaction) => {
    void handleInteraction(interaction, client);
  });
}

async function handleInteraction(
  interaction: Interaction,
  client: DiscordClient,
): Promise<void> {
  if (!interaction.isChatInputCommand()) return;

  const handler = handlers.get(interaction.commandName);
  if (!handler) return;

  if (!mcpClientRef) {
    logger.error('MCP client not initialized');
    await interaction.reply({
      content: 'MCP chưa được khởi tạo. Vui lòng thử lại sau.',
      ephemeral: true,
    });
    return;
  }

  try {
    await handler(interaction, client, mcpClientRef);
  } catch (error) {
    logger.error(`Error executing ${interaction.commandName}:`, error);
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp({
        content: 'Xin lỗi, đã có lỗi xảy ra khi xử lý lệnh.',
        ephemeral: true,
      }).catch(() => {});
    } else {
      await interaction.reply({
        content: 'Xin lỗi, đã có lỗi xảy ra khi xử lý lệnh.',
        ephemeral: true,
      }).catch(() => {});
    }
  }
}

export function getCommandBuilders(): Collection<string, SlashCommandBuilder> {
  return commandBuilders;
}

/* ── Handlers ── */

async function helpHandler(
  interaction: ChatInputCommandInteraction,
  _client: DiscordClient,
  _mcp: ReconnectingMcpClient,
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
          '`/status` — Kiểm tra trạng thái bot\n' +
          '`/search` — Tìm kiếm văn bản pháp luật',
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
  _client: DiscordClient,
  _mcp: ReconnectingMcpClient,
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
  client: DiscordClient,
  mcp: ReconnectingMcpClient,
): Promise<void> {
  const uptime = getUptimeString(client.uptime);
  const guildCount = client.guilds.cache.size;
  const memberCount = client.guilds.cache.reduce(
    (acc, g) => acc + (g.memberCount || 0),
    0,
  );

  let mcpStatus = '❌ Không kết nối';
  try {
    await mcp.listTools();
    mcpStatus = '✅ Đã kết nối';
  } catch {
    mcpStatus = '❌ Lỗi kết nối';
  }

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
        name: 'MCP Server',
        value: mcpStatus,
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

async function searchHandler(
  interaction: ChatInputCommandInteraction,
  _client: DiscordClient,
  mcp: ReconnectingMcpClient,
): Promise<void> {
  const keyword = interaction.options.getString('keyword', true);
  const searchScope = interaction.options.getString('phạm-vi', false);
  const docTypesRaw = interaction.options.getString('loai-van-ban', false);
  const issuingBodiesRaw = interaction.options.getString('co-quan', false);
  const validityStatus = interaction.options.getString('hieu-luc', false);
  const maxResults = interaction.options.getInteger('so-ket-qua', false) ?? 5;

  const toolArgs: Record<string, unknown> = { keyword };

  if (searchScope) toolArgs.searchScope = searchScope;
  if (docTypesRaw) {
    toolArgs.documentTypes = splitCsv(docTypesRaw);
  }
  if (issuingBodiesRaw) {
    toolArgs.issuingBodies = splitCsv(issuingBodiesRaw);
  }
  if (validityStatus === 'all') {
    toolArgs.includeHistorical = true;
  } else if (validityStatus) {
    toolArgs.validityStatus = validityStatus;
  }

  toolArgs.pageSize = Math.min(maxResults, MAX_SEARCH_RESULTS);
  toolArgs.page = 1;

  await interaction.deferReply({ ephemeral: true });

  try {
    const result = await mcp.callTool('search_documents', toolArgs);
    const block = result.content?.[0];
    const rawResult =
      block && block.type === 'text'
        ? block.text
        : JSON.stringify(result);
    const data = JSON.parse(rawResult) as SearchResponse;

    const documents = data.documents ?? data.results ?? [];
    const total =
      data.total ?? data.totalCount ?? data.totalResults ?? documents.length;

    if (!documents.length) {
      await interaction.editReply({
        embeds: [
          new EmbedBuilder()
            .setTitle('🔍 Không Tìm Thấy Kết Quả')
            .setColor(0xffaa00)
            .setDescription(
              `Không có văn bản nào khớp với từ khóa "${keyword}".\n\nThử thay đổi từ khóa hoặc mở rộng phạm vi tìm kiếm.`,
            )
            .setTimestamp(),
        ],
      });
      return;
    }

    const sliced = documents.slice(0, maxResults);
    const fields = sliced.map((doc, i) => ({
      name: `${i + 1}. ${doc.title ?? doc.tieuDe ?? 'Không có tiêu đề'}`,
      value: formatDocumentSummary(doc),
      inline: false,
    }));

    const embed = new EmbedBuilder()
      .setTitle('🔍 Kết Quả Tìm Kiếm')
      .setColor(0x0099ff)
      .setDescription(
        `Tìm thấy ${total} văn bản khớp với "${keyword}"`,
      )
      .addFields(fields)
      .setFooter({
        text: `Hiển thị ${Math.min(sliced.length, total)} / ${total} kết quả`,
      })
      .setTimestamp();

    if (embed.data.description && embed.data.description.length > DISCORD_EMBED_DESC_LIMIT) {
      embed.setDescription(
        embed.data.description?.slice(0, DISCORD_EMBED_DESC_LIMIT - 3) + '...',
      );
    }

    for (const field of embed.data.fields ?? []) {
      if (field.value && field.value.length > DISCORD_FIELD_VALUE_LIMIT) {
        field.value = field.value.slice(0, DISCORD_FIELD_VALUE_LIMIT - 3) + '...';
      }
    }

    await interaction.editReply({ embeds: [embed] });
  } catch (error) {
    logger.error('Search failed:', error);
    await interaction.editReply({
      content:
        'Xin lỗi, tìm kiếm thất bại. Vui lòng thử lại sau.',
    });
  }
}

/* ── Helpers ── */

function splitCsv(value: string): string[] {
  return value
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function formatDocumentSummary(doc: LegalDocument): string {
  const parts: string[] = [];

  const strVal = (v?: string) => (typeof v === 'string' ? v : '');

  const soHieu = strVal(doc.soHieu) || strVal(doc.citation);
  if (soHieu) parts.push(`**Số hiệu:** ${soHieu}`);

  const loai = strVal(doc.documentType) || strVal(doc.hinhThuc);
  if (loai) parts.push(`**Loại:** ${loai}`);

  const coQuan = strVal(doc.issuingBody) || strVal(doc.coQuanBanHanh);
  if (coQuan) parts.push(`**Cơ quan:** ${coQuan}`);

  const ngayBanHanh = strVal(doc.effectiveDate) || strVal(doc.ngayBanHanh);
  if (ngayBanHanh) parts.push(`**Ban hành:** ${ngayBanHanh}`);

  const hieuLuc = strVal(doc.validityStatus) || strVal(doc.trangThaiHieuLuc);
  if (hieuLuc) parts.push(`**Hiệu lực:** ${hieuLuc}`);

  const id = strVal(doc.id);
  if (id) parts.push(`ID: ${id.slice(0, 8)}...`);

  return parts.join('\n');
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