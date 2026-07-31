import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, IsUUID } from 'class-validator';

export const NODE_TYPE_OPTIONS = [
  'phan',
  'chuong',
  'muc',
  'tieu_muc',
  'dieu',
  'khoan',
  'diem',
  'phu_luc',
] as const;

export class RetrieveNodeDto {
  @ApiProperty({
    description: 'Document UUID (from /laws/index/search results or crawl).',
  })
  @IsUUID('4')
  documentId: string;

  @ApiPropertyOptional({
    description:
      'Filter by node type. Omit to return all root nodes (full document tree).',
    enum: NODE_TYPE_OPTIONS,
  })
  @IsOptional()
  @IsIn(NODE_TYPE_OPTIONS)
  nodeType?: string;

  @ApiPropertyOptional({
    description:
      'Filter by ordinal number (e.g. "31" for "Điều 31", "2" for "Khoản 2", "a" for "Điểm a"). Must be used together with `nodeType`.',
    example: '31',
  })
  @IsOptional()
  @IsString()
  number?: string;

  @ApiPropertyOptional({
    description:
      'Node UUID to retrieve a specific node and its subtree. Overrides nodeType+label filters.',
  })
  @IsOptional()
  @IsUUID('4')
  nodeId?: string;
}
