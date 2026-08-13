import { ApiProperty } from '@nestjs/swagger';

export class JobSubmittedResponseDto {
  @ApiProperty({
    description:
      'BullMQ job id — pass to GET /jobs/:jobId to poll status.',
    example: '1',
  })
  jobId: string;

  @ApiProperty({
    description: 'Always "pending" immediately after submission.',
    example: 'pending',
  })
  status: 'pending';

  @ApiProperty({
    description: 'Human-readable pointer to the polling endpoint.',
    example: 'Job submitted. Poll GET /jobs/:jobId for status.',
  })
  message: string;
}
