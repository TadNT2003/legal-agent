import { ApiProperty } from '@nestjs/swagger';

export class SearchDocumentItemDto {
  @ApiProperty({
    description: 'Internal document UUID. Use with GET /laws/index/retrieve/nodes.',
    example: 'bd76b9be-5fb6-45c4-9e32-5d16b7866445',
  })
  documentId: string;

  @ApiProperty({
    description:
      'A vbpl.vn document detail page URL, directly usable as syncDocument\'s `url`. The human-readable slug segment is a fixed placeholder, not vbpl.vn\'s real one — confirmed live that vbpl.vn resolves the document by the trailing "--<id>" alone.',
    example: 'https://vbpl.vn/van-ban/chi-tiet/van-ban--32833',
  })
  sourceUrl: string;

  @ApiProperty({ description: '"Số hiệu" — the document\'s citation number.' })
  citation: string;

  @ApiProperty({ description: 'Full document title.' })
  title: string;

  @ApiProperty({ description: '"Loại văn bản".' })
  documentType: string;

  @ApiProperty({ description: '"Cơ quan ban hành".' })
  issuingBody: string;

  @ApiProperty({ nullable: true, example: '2024-01-18' })
  issuedDate: string | null;

  @ApiProperty({ nullable: true, example: '2025-01-01' })
  effectiveDate: string | null;

  @ApiProperty({ nullable: true, example: null })
  expiryDate: string | null;

  @ApiProperty({ description: '"Tình trạng hiệu lực".' })
  validityStatus: string;
}

export class SearchDocumentsResponseDto {
  @ApiProperty({
    description: 'Total matches across all pages.',
  })
  total: number;

  @ApiProperty({ description: 'Current page number (1-based).' })
  page: number;

  @ApiProperty({ description: 'Results per page.' })
  pageSize: number;

  @ApiProperty({ type: [SearchDocumentItemDto] })
  items: SearchDocumentItemDto[];
}
