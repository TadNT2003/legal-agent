import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsOptional,
  IsString,
  IsUrl,
  Matches,
} from 'class-validator';

export class DownloadByUrlDto {
  @ApiProperty({
    description:
      'A vanban.chinhphu.vn document detail page URL (?pageid=...&docid=...).',
    example: 'https://vanban.chinhphu.vn/?pageid=27160&docid=213310',
  })
  @IsUrl({ protocols: ['https'], require_protocol: true })
  url: string;

  /** Escape hatch for tiers/subtypes law-tier-classifier.ts doesn't recognize yet. */
  @ApiPropertyOptional({
    description:
      "Escape hatch for tiers/subtypes the automatic classifier doesn't recognize yet — a relative path of lowercase, hyphenated segments under laws/.",
    example: '05-nghi-dinh-nghi-quyet-chinh-phu',
  })
  @IsOptional()
  @IsString()
  @Matches(/^[a-z0-9-]+(\/[a-z0-9-]+)*$/, {
    message:
      'subdirOverride must be a relative path of lowercase, hyphenated segments',
  })
  subdirOverride?: string;

  @ApiPropertyOptional({
    description:
      'Re-download and overwrite even if the file already exists on disk.',
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  force?: boolean;
}
