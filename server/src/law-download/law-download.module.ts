import { Module } from '@nestjs/common';
import { LawDownloadController } from './law-download.controller';
import { LawDownloadService } from './law-download.service';
import { LawManifestService } from './law-manifest.service';
import { VanBanChinhPhuClientService } from './vanban-chinh-phu-client.service';

@Module({
  controllers: [LawDownloadController],
  providers: [
    LawDownloadService,
    LawManifestService,
    VanBanChinhPhuClientService,
  ],
  exports: [LawDownloadService],
})
export class LawDownloadModule {}
