import { Module } from '@nestjs/common';
import { LawUtilsModule } from '../utils/law-utils.module';
import { LawDownloadController } from './law-download.controller';
import { LawDownloadService } from './law-download.service';
import { VanBanChinhPhuClientService } from './vanban-chinh-phu-client.service';

@Module({
  imports: [LawUtilsModule],
  controllers: [LawDownloadController],
  providers: [LawDownloadService, VanBanChinhPhuClientService],
  exports: [LawDownloadService],
})
export class LawDownloadModule {}
