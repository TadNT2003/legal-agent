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
import { LawDownloadModule } from './law-download/law-download.module';
import { lawDownloadConfig } from './law-download/law-download.config';

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
      ],
      validationSchema: envValidationSchema,
      validationOptions: {
        abortEarly: false,
      },
    }),
    LawDownloadModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
