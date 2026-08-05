import { Module } from '@nestjs/common';
import { LawManifestService } from './law-manifest.service';

/**
 * Cross-cutting providers shared by the download and catalog submodules —
 * currently just `LawManifestService` (the manifest.json/download-log.csv
 * read-write layer both submodules depend on). Pure helpers/interfaces in
 * this folder (document-matcher, tier-definitions, filename slugging, ...)
 * aren't NestJS providers and don't need to be registered here — they're
 * imported directly wherever needed.
 */
@Module({
  providers: [LawManifestService],
  exports: [LawManifestService],
})
export class LawUtilsModule {}
