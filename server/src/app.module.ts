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
import { LawModule } from './law/law.module';
import { lawDownloadConfig } from './law/utils/law-download.config';
import { LawIndexModule } from './law-index/law-index.module';
import { lawIndexConfig } from './law-index/law-index.config';

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
        lawIndexConfig,
      ],
      validationSchema: envValidationSchema,
      validationOptions: {
        abortEarly: false,
      },
    }),
    LawModule,
    LawIndexModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
