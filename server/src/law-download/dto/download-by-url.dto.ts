import {
  IsBoolean,
  IsOptional,
  IsString,
  IsUrl,
  Matches,
} from 'class-validator';

export class DownloadByUrlDto {
  @IsUrl({ protocols: ['https'], require_protocol: true })
  url: string;

  /** Escape hatch for tiers/subtypes law-tier-classifier.ts doesn't recognize yet. */
  @IsOptional()
  @IsString()
  @Matches(/^[a-z0-9-]+(\/[a-z0-9-]+)*$/, {
    message:
      'subdirOverride must be a relative path of lowercase, hyphenated segments',
  })
  subdirOverride?: string;

  @IsOptional()
  @IsBoolean()
  force?: boolean;
}
