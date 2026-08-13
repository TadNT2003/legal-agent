import { Body, Controller, Post } from '@nestjs/common';
import {
  ApiBadGatewayResponse,
  ApiCreatedResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { ChinhPhuCrawlService } from './chinhphu-crawl.service';
import { SyncChinhPhuDocumentDto } from './dto/sync-chinhphu-document.dto';
import { SyncChinhPhuDocumentResponseDto } from './dto/sync-chinhphu-document-response.dto';

@ApiTags('crawl-chinhphu')
@Controller()
export class ChinhPhuCrawlController {
  constructor(private readonly service: ChinhPhuCrawlService) {}

  @ApiOperation({
    summary:
      'Sync one document from vanban.chinhphu.vn into Postgres (skeleton, supplementary source)',
    description:
      'Supplementary source alongside vbpl.vn (see POST /crawl/url) — fetches a vanban.chinhphu.vn document ' +
      'detail page and upserts its metadata. vanban.chinhphu.vn exposes no server-rendered full text (only ' +
      'downloadable PDF/DOC/RTF attachments), so today every document is persisted with indexScope=' +
      '"metadata_only" and no document_node tree, until a document-processing tool is wired into ' +
      'DOCUMENT_TEXT_EXTRACTOR (see document-text-extractor.ts). Never overwrites a document already indexed ' +
      'under the same citation from another source.',
  })
  @ApiCreatedResponse({ type: SyncChinhPhuDocumentResponseDto })
  @ApiBadGatewayResponse({
    description:
      'vanban.chinhphu.vn failed to load the page, or the page has no recognizable "Số ký hiệu".',
  })
  @Post('crawl-chinhphu/url')
  syncDocument(@Body() dto: SyncChinhPhuDocumentDto) {
    return this.service.syncDocument(dto.url);
  }
}
