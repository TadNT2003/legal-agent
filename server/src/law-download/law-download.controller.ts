import { Body, Controller, Post } from '@nestjs/common';
import { BatchDownloadDto } from './dto/batch-download.dto';
import { DownloadByUrlDto } from './dto/download-by-url.dto';
import { SearchDownloadDto } from './dto/search-download.dto';
import { LawDownloadService } from './law-download.service';

@Controller('laws/downloads')
export class LawDownloadController {
  constructor(private readonly downloadService: LawDownloadService) {}

  /** Download a single document from its vanban.chinhphu.vn detail page URL. */
  @Post()
  downloadOne(@Body() dto: DownloadByUrlDto) {
    return this.downloadService.downloadFromUrl(dto);
  }

  /** Download a batch of documents from a list of vanban.chinhphu.vn detail page URLs. */
  @Post('batch')
  downloadBatch(@Body() dto: BatchDownloadDto) {
    return this.downloadService.downloadBatch(dto.documents);
  }

  /** Run the vanban.chinhphu.vn "TÌM KIẾM VĂN BẢN" filter search and download matches. */
  @Post('search')
  downloadBySearch(@Body() dto: SearchDownloadDto) {
    return this.downloadService.downloadBySearch(dto);
  }
}
