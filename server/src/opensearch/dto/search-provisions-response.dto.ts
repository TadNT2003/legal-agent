import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class MatchedKhoanDto {
  @ApiProperty()
  khoanId: string;

  @ApiProperty()
  label: string;

  @ApiProperty()
  text: string;
}

export class SearchProvisionHitDto {
  @ApiProperty()
  documentId: string;

  @ApiProperty()
  citationId: string;

  @ApiProperty()
  documentType: string;

  @ApiProperty({ description: 'ltree path, e.g. "chuong1.dieu5".' })
  path: string;

  @ApiProperty({ description: '"Điều 5" / "Phụ lục I".' })
  label: string;

  @ApiPropertyOptional()
  heading?: string;

  @ApiProperty()
  score: number;

  @ApiProperty({
    type: [MatchedKhoanDto],
    description:
      'Which specific Khoản matched (from the nested query’s inner_hits) — the citation a user needs is often the Khoản, not just the Điều.',
  })
  matchedKhoan: MatchedKhoanDto[];
}

export class SearchProvisionsResponseDto {
  @ApiProperty()
  total: number;

  @ApiProperty()
  page: number;

  @ApiProperty()
  pageSize: number;

  @ApiProperty({ type: [SearchProvisionHitDto] })
  items: SearchProvisionHitDto[];
}
