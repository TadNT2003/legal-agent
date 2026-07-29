import { Module } from '@nestjs/common';
import { LawCatalogModule } from './catalog/law-catalog.module';
import { LawDownloadModule } from './download/law-download.module';

/** Umbrella module for everything under laws/ — fetching (download/), browsing/serving (catalog/), and their shared plumbing (utils/). */
@Module({
  imports: [LawDownloadModule, LawCatalogModule],
})
export class LawModule {}
