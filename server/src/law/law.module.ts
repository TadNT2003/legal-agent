import { Module } from '@nestjs/common';
import { LawCatalogModule } from './catalog/law-catalog.module';

/**
 * Umbrella module for what's still nested under law/ — browsing/serving
 * (catalog/) and shared plumbing (utils/). `download/` moved to a top-level
 * module (see AppModule) as part of flattening this grouping; other
 * submodules will follow the same way.
 */
@Module({
  imports: [LawCatalogModule],
})
export class LawModule {}
