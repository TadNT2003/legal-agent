import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class RetrieveNodeItemDto {
  @ApiProperty({ description: 'Node UUID.' })
  id: string;

  @ApiProperty({
    description:
      'Node type: phan, chuong, muc, tieu_muc, dieu, khoan, diem, phu_luc.',
    example: 'dieu',
  })
  nodeType: string;

  @ApiProperty({
    description:
      'Display label as parsed from vbpl.vn, e.g. "Điều 5", "Chương II", "Khoản 1".',
    example: 'Điều 5',
  })
  label: string;

  @ApiProperty({
    description: 'Sort key, e.g. "5", "5a", "2". Always ASCII/arabic digits.',
    example: '5',
  })
  ordinal: string;

  @ApiPropertyOptional({
    description:
      'Heading/title for phan/chuong/muc/tieu_muc/dieu nodes. Null for khoan/diem.',
    nullable: true,
  })
  heading: string | null;

  @ApiPropertyOptional({
    description:
      'Full text content of this node, reconstructed in vbpl.vn format including all descendant text. For leaf nodes this is just their own text. For containers (Phần, Chương, Điều...) it includes the entire subtree text.',
    nullable: true,
  })
  fullText: string | null;

  @ApiPropertyOptional({
    description:
      'Node-level content (without descendant text). Null for pure container nodes.',
    nullable: true,
  })
  textContent: string | null;

  @ApiPropertyOptional({
    description: 'Content classification for phụ lục nodes.',
    nullable: true,
  })
  contentClass: string | null;

  @ApiPropertyOptional({
    description: 'Materialized ltree path, e.g. "chuong2.muc1.dieu5.khoan2".',
  })
  path: string;

  @ApiProperty({
    description: 'Child nodes (recursive).',
    type: () => [RetrieveNodeItemDto],
  })
  children: RetrieveNodeItemDto[];
}

export class RetrieveNodeResponseDto {
  @ApiProperty({
    description: 'Document citation identifier.',
  })
  citationId: string;

  @ApiProperty({
    description: 'Document title.',
  })
  title: string;

  @ApiProperty({
    type: [RetrieveNodeItemDto],
    description:
      'Matching root nodes and their complete subtrees. If no nodeType/label/nodeId filter is provided, returns all root nodes (full document structure).',
  })
  nodes: RetrieveNodeItemDto[];
}
