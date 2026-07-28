import {
  BadRequestException,
  Controller,
  Get,
  Query,
  Res,
  StreamableFile,
} from '@nestjs/common';
import { createReadStream } from 'fs';
import type { Response } from 'express';
import { FindDocumentDto } from './dto/find-document.dto';
import { buildContentDisposition, mimeTypeForFilename } from './http-file.util';
import { LawCatalogService } from './law-catalog.service';

@Controller('laws')
export class LawCatalogController {
  constructor(private readonly catalog: LawCatalogService) {}

  /** Document count and total size per tier folder (and its sub-folders, e.g. tier 2's luat/luat-sua-doi-bo-sung). */
  @Get('tiers')
  getTierOverview() {
    return this.catalog.getTierOverview();
  }

  /**
   * Serves a single already-downloaded document — by exact citation, or by
   * closest title match — optionally narrowed to a real date range.
   */
  @Get('documents')
  async serveDocument(
    @Query() query: FindDocumentDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    if (!query.citation && !query.title) {
      throw new BadRequestException(
        'Provide at least one of "citation" or "title".',
      );
    }

    const { entry, score, absolutePath } =
      await this.catalog.findDocument(query);

    res.set({
      'X-Document-Citation': entry.citation,
      'X-Document-Title': encodeURIComponent(entry.title),
      'X-Match-Score': String(score),
      'Content-Disposition': buildContentDisposition(entry.filename),
    });

    return new StreamableFile(createReadStream(absolutePath), {
      type: mimeTypeForFilename(entry.filename),
    });
  }
}
