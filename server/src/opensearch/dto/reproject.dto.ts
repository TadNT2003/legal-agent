import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, IsUUID } from 'class-validator';

/** Exactly one of documentId/citation is expected — enforced in OpenSearchService.reprojectDocument, not here, matching this codebase's preference for simple DTO validation over conditional-field validators. */
export class ReprojectDto {
  @ApiPropertyOptional({ description: 'document.id to reproject.' })
  @IsOptional()
  @IsUUID('4')
  documentId?: string;

  @ApiPropertyOptional({
    description:
      'citation_id to resolve to a document.id, if documentId is not given.',
  })
  @IsOptional()
  @IsString()
  citation?: string;
}
