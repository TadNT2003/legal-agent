import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  // Without this, Nest never calls OnModuleDestroy on SIGTERM/SIGINT — so
  // VbplClientService's cleanup (closing its Playwright browser/context/page)
  // never runs on process shutdown, graceful or not, and every dev-server
  // restart orphans its browser. Confirmed live: 50 orphaned chrome.exe
  // processes accumulated across a single day's restarts before this was
  // caught (see docs/monitoring/law-index-flagged-documents.md).
  app.enableShutdownHooks();

  // Allow very long requests for sync single-doc law-index operations (4
  // page loads against vbpl.vn, throttled). Async job endpoints
  // (POST /laws/index/crawl/all|batch|search) return immediately once
  // submitted, so this timeout only ever applies to the synchronous
  // single-doc sync/update endpoints — it exists to stop the OS/proxy from
  // killing those requests early, not to bound them tightly.
  //
  // getHttpServer() (the raw Node http.Server), not
  // getHttpAdapter().getInstance() (the Express app object, which has no
  // setTimeout method of its own).
  const httpServer = app.getHttpServer() as {
    setTimeout: (msecs: number) => void;
  };
  httpServer.setTimeout(300000); // 5 minutes

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
    .addTag('downloads', 'Fetch documents from vanban.chinhphu.vn')
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
