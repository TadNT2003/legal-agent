import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsOptional } from 'class-validator';

/**
 * Query flag shared by the two update-only (PUT) endpoints.
 *
 * Deliberately NOT `@Type(() => Boolean)` — the pattern SearchDocumentsDto
 * uses for `exactPhrase` — because class-transformer applies the `Boolean`
 * constructor and `Boolean('false') === true`, so *every* non-empty
 * querystring value would switch the flag on, `?force=false` included. That
 * is a harmless quirk for a search toggle; here it would silently turn a
 * cheap no-op batch into up to 100 full browser re-scrapes. Only an explicit
 * `true`/`1` opts in — anything else, including a bare `?force`, stays off.
 */
export class ForceUpdateDto {
  @ApiPropertyOptional({
    description:
      'Re-write every column even when `content_version` is unchanged. Off by default, preserving the ' +
      'normal behaviour where an unchanged document is skipped as a no-op. Its one intended use is ' +
      'backfilling a column added *after* a document was last scraped: `content_version` is hashed from ' +
      'the vbpl.vn page, not from the stored row, so adding a column cannot change it and an ordinary ' +
      'update would skip the row and leave the new column NULL. Costs a full 3-tab re-scrape per URL, so ' +
      'keep forced batches small.',
    default: false,
    example: false,
  })
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true' || value === '1')
  @IsBoolean()
  force?: boolean;
}
