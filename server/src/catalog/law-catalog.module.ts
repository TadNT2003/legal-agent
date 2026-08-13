import { Module } from '@nestjs/common';
import { LawUtilsModule } from '../utils/law-utils.module';
import { LawCatalogController } from './law-catalog.controller';
import { LawCatalogService } from './law-catalog.service';

@Module({
  imports: [LawUtilsModule],
  controllers: [LawCatalogController],
  providers: [LawCatalogService],
  exports: [LawCatalogService],
})
export class LawCatalogModule {}
