import {
  BadRequestException,
  Controller,
  Get,
  Query,
  Res,
} from '@nestjs/common';
import { ApiOperation, ApiProduces, ApiTags } from '@nestjs/swagger';
import archiver from 'archiver';
import { createReadStream } from 'fs';
import { stat } from 'fs/promises';
import type { Response } from 'express';
import { FindDocumentDto } from './dto/find-document.dto';
import { buildContentDisposition, mimeTypeForFilename } from './http-file.util';
import { LawCatalogService } from './law-catalog.service';

@ApiTags('law-catalog')
@Controller('laws')
export class LawCatalogController {
  constructor(private readonly catalog: LawCatalogService) {}

  /** Document count and total size per tier folder (and its sub-folders, e.g. tier 2's luat/luat-sua-doi-bo-sung). */
  @ApiOperation({
    summary: 'Tier folder stats',
    description:
      "Document count and total size per tier folder under laws/ (and its sub-folders, e.g. tier 2's luat/luat-sua-doi-bo-sung).",
  })
  @Get('tiers')
  getTierOverview() {
    return this.catalog.getTierOverview();
  }

  /**
   * Serves every file belonging to one already-downloaded document — by exact
   * citation, or by closest title match — optionally narrowed to a real date
   * range. A single-file document streams back as-is; a document with phụ lục
   * attachments streams back as a zip of every file (main text + annexes).
   */
  @ApiOperation({
    summary: 'Serve a downloaded document',
    description:
      "Resolves citation or closest title match (optionally date-filtered) and streams every file belonging to it — the raw file itself when there's only one, or a .zip of the main text + every phụ lục attachment when there are several.",
  })
  @ApiProduces(
    'application/pdf',
    'application/msword',
    'application/zip',
    'application/octet-stream',
  )
  @Get('documents')
  async serveDocument(
    @Query() query: FindDocumentDto,
    @Res() res: Response,
  ): Promise<void> {
    if (!query.citation && !query.title) {
      throw new BadRequestException(
        'Provide at least one of "citation" or "title".',
      );
    }

    const { citation, title, score, files } =
      await this.catalog.findDocumentGroup(query);

    res.set({
      'X-Document-Citation': citation,
      'X-Document-Title': encodeURIComponent(title),
      'X-Match-Score': String(score),
      'X-Document-File-Count': String(files.length),
    });

    if (files.length === 1) {
      const [{ entry, absolutePath }] = files;
      const { size } = await stat(absolutePath);
      res.set({
        'Content-Type': mimeTypeForFilename(entry.filename),
        'Content-Disposition': buildContentDisposition(entry.filename),
        'Content-Length': String(size),
      });
      createReadStream(absolutePath).pipe(res);
      return;
    }

    // Every entry sharing a citation was written with the same `folder`
    // (see ../download/law-download.service.ts) — safe to read it off any one of them.
    const zipFilename = `${files[0].entry.folder}.zip`;
    res.set({
      'Content-Type': 'application/zip',
      'Content-Disposition': buildContentDisposition(zipFilename),
    });

    const archive = archiver('zip');
    archive.on('error', (err) => res.destroy(err));
    archive.pipe(res);
    for (const { entry, absolutePath } of files) {
      archive.file(absolutePath, { name: entry.filename });
    }
    await archive.finalize();
  }
}
