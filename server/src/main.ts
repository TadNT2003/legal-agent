import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  const swaggerConfig = new DocumentBuilder()
    .setTitle('legal-agent API')
    .setDescription(
      'Law document download, catalog, and (later) RAG endpoints for the legal-agent server.',
    )
    .setVersion('0.1')
    .addTag('law-downloads', 'Fetch documents from vanban.chinhphu.vn')
    .addTag('law-catalog', 'Browse and serve already-downloaded documents')
    .addTag(
      'law-index',
      'Scrape vbpl.vn (Trung ương only) and index documents into Postgres',
    )
    .build();
  const swaggerDocument = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('api', app, swaggerDocument);

  const configService = app.get(ConfigService);
  await app.listen(configService.get<number>('app.port') ?? 3000);
}
bootstrap();
