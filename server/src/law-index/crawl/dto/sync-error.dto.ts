import { ApiProperty } from '@nestjs/swagger';

export class SyncErrorDto {
  @ApiProperty({ description: 'The document URL that failed to sync.' })
  url: string;

  @ApiProperty({
    description:
      'Error message — network failure, unrecognized relation category, unmapped validity status, etc.',
  })
  error: string;
}
