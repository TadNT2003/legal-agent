import { Module } from '@nestjs/common';
import { LawManifestService } from './law-manifest.service';

/**
 * Cross-cutting providers shared across top-level modules that need them —
 * currently `server/src/download/` and `server/src/law/catalog/`, both
 * depending on `LawManifestService` (the manifest.json/download-log.csv
 * read-write layer). Pure helpers/interfaces in this folder
 * (document-matcher, tier-definitions, text-normalize, ...) aren't NestJS
 * providers and don't need to be registered here — they're imported
 * directly wherever needed. `filename.util.ts` used to live alongside these
 * but moved with `download/` since nothing else uses it.
 */
@Module({
  providers: [LawManifestService],
  exports: [LawManifestService],
})
export class LawUtilsModule {}
