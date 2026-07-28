import { Module } from '@nestjs/common';
import { LawCatalogController } from './law-catalog.controller';
import { LawCatalogService } from './law-catalog.service';
import { LawDownloadController } from './law-download.controller';
import { LawDownloadService } from './law-download.service';
import { LawManifestService } from './law-manifest.service';
import { VanBanChinhPhuClientService } from './vanban-chinh-phu-client.service';

@Module({
  controllers: [LawDownloadController, LawCatalogController],
  providers: [
    LawDownloadService,
    LawCatalogService,
    LawManifestService,
    VanBanChinhPhuClientService,
  ],
  exports: [LawDownloadService, LawCatalogService],
})
export class LawDownloadModule {}
