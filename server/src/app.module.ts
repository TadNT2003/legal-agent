import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import {
  appConfig,
  chromadbConfig,
  neo4jConfig,
  opensearchConfig,
  postgresConfig,
} from './config/configuration';
import { envValidationSchema } from './config/env.validation';
import { lawDownloadConfig } from './utils/law-download.config';
import { LawDownloadModule } from './download/law-download.module';
import { LawCatalogModule } from './catalog/law-catalog.module';
import { RetrieveModule } from './retrieve/retrieve.module';
import { SyncModule } from './sync/sync.module';
import { CrawlModule } from './crawl/crawl.module';
import { crawlConfig } from './crawl/crawl.config';
import { CrawlChinhPhuModule } from './crawl-chinhphu/crawl-chinhphu.module';
import { jobQueueConfig } from './job-queue/job-queue.config';
import { OpenSearchModule } from './opensearch/opensearch.module';
import { opensearchProjectorConfig } from './opensearch/opensearch.config';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
      load: [
        appConfig,
        postgresConfig,
        opensearchConfig,
        neo4jConfig,
        chromadbConfig,
        lawDownloadConfig,
        crawlConfig,
        jobQueueConfig,
        opensearchProjectorConfig,
      ],
      validationSchema: envValidationSchema,
      validationOptions: {
        abortEarly: false,
      },
    }),
    LawDownloadModule,
    LawCatalogModule,
    RetrieveModule,
    SyncModule,
    OpenSearchModule,
    CrawlModule,
    CrawlChinhPhuModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
