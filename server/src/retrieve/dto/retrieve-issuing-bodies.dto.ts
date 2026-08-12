import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

export class RetrieveIssuingBodiesDto {
  @ApiPropertyOptional({
    description: 'Filter by issuing body name (case-insensitive substring).',
  })
  @IsOptional()
  @IsString()
  keyword?: string;

  @ApiPropertyOptional({
    description: 'Filter by scope: "national" or "local".',
    enum: ['national', 'local'],
  })
  @IsOptional()
  @IsString()
  scope?: 'national' | 'local';
}

export class IssuingBodyItemDto {
  @ApiProperty({ description: 'Internal UUID.' })
  id: string;

  @ApiProperty({ description: 'Issuing body name.' })
  name: string;

  @ApiProperty({ nullable: true, description: 'English name.' })
  nameEn: string | null;

  @ApiProperty({
    description:
      'Authority rank (lower = higher authority, per Luật 64/2025/QH15).',
  })
  authorityRank: number;

  @ApiProperty({ description: 'Scope: "national" (central) or "local".' })
  scope: 'national' | 'local';

  @ApiProperty({
    description: 'Parent issuing body UUID, if this body is subordinate.',
    nullable: true,
  })
  parentBodyId: string | null;

  @ApiProperty({
    description: 'Number of documents issued by this body in the local index.',
  })
  documentCount: number;
}

export class RetrieveIssuingBodiesResponseDto {
  @ApiProperty({ type: [IssuingBodyItemDto] })
  items: IssuingBodyItemDto[];

  @ApiProperty({ description: 'Total issuing bodies in the local index.' })
  total: number;
}
