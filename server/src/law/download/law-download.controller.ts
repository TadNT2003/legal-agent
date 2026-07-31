import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { BatchDownloadDto } from './dto/batch-download.dto';
import { CheckStatusDto } from './dto/check-status.dto';
import { DownloadByUrlDto } from './dto/download-by-url.dto';
import { SearchDownloadDto } from './dto/search-download.dto';
import { SearchQueryDto } from './dto/search-query.dto';
import { LawDownloadService } from './law-download.service';

@ApiTags('law-downloads')
@Controller('laws/downloads')
export class LawDownloadController {
  constructor(private readonly downloadService: LawDownloadService) {}

  /** Download a single document from its vanban.chinhphu.vn detail page URL. */
  @ApiOperation({
    summary: 'Download one document',
    description:
      'Fetches every attached file (main text + phụ lục) from a vanban.chinhphu.vn document detail page URL and saves them into laws/. The `url` field must be a vanban.chinhphu.vn detail page URL.',
  })
  @Post('url')
  downloadOne(@Body() dto: DownloadByUrlDto) {
    return this.downloadService.downloadFromUrl(dto);
  }

  /**
   * Check whether a vanban.chinhphu.vn document URL is already downloaded,
   * without fetching or writing any file.
   */
  @ApiOperation({
    summary: 'Check download status',
    description:
      'Predicts what POST /laws/downloads would do for this URL (tier, filenames, which files already exist) without fetching or writing anything.',
  })
  @Get('status')
  checkStatus(@Query() dto: CheckStatusDto) {
    return this.downloadService.checkStatus(dto.url, dto.subdirOverride);
  }

  /** Download a batch of documents from a list of vanban.chinhphu.vn detail page URLs. */
  @ApiOperation({
    summary: 'Download a batch of documents',
    description: 'Same as POST /laws/downloads, for up to 100 URLs at once.',
  })
  @Post('batch')
  downloadBatch(@Body() dto: BatchDownloadDto) {
    return this.downloadService.downloadBatch(dto.documents);
  }

  @ApiOperation({
    summary: 'Search documents',
    description:
      'Runs the vanban.chinhphu.vn "TÌM KIẾM VĂN BẢN" filter search (keyword/category/org/year) and returns the list of matching document detail URLs without downloading anything.',
  })
  @Get('search')
  search(@Query() dto: SearchQueryDto) {
    return this.downloadService.search(dto);
  }

  /** Run the vanban.chinhphu.vn "TÌM KIẾM VĂN BẢN" filter search and download matches. */
  @ApiOperation({
    summary: 'Search and download',
    description:
      'Runs the vanban.chinhphu.vn "TÌM KIẾM VĂN BẢN" filter search (keyword/category/org/year) and downloads every match, up to maxResults.',
  })
  @Post('search')
  downloadBySearch(@Body() dto: SearchDownloadDto) {
    return this.downloadService.downloadBySearch(dto);
  }
}
