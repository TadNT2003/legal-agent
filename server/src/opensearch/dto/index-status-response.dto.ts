import { ApiProperty } from '@nestjs/swagger';

export class IndexStatusResponseDto {
  @ApiProperty()
  readAlias: string;

  @ApiProperty()
  writeAlias: string;

  @ApiProperty({
    nullable: true,
    description:
      'Concrete index the read alias currently resolves to, or null if ensureIndex was never called.',
  })
  resolvedIndex: string | null;

  @ApiProperty({ enum: ['green', 'yellow', 'red'], nullable: true })
  health: 'green' | 'yellow' | 'red' | null;

  @ApiProperty({
    nullable: true,
    description:
      'Document count in the resolved index — compare against Postgres to spot drift (the manual reconciliation stand-in until CDC exists).',
  })
  docsCount: number | null;
}
