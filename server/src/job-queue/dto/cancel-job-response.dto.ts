import { ApiProperty } from '@nestjs/swagger';

export class CancelJobResponseDto {
  @ApiProperty({ example: '1' })
  jobId: string;

  @ApiProperty({
    description:
      "'cancelled' if the pending job was removed, 'already-running' if it's currently being processed " +
      "(BullMQ can't remove an in-flight job), 'not-found' if the id doesn't exist.",
    enum: ['cancelled', 'already-running', 'not-found'],
    example: 'cancelled',
  })
  result: 'cancelled' | 'already-running' | 'not-found';
}
