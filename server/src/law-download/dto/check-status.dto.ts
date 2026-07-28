import { IsOptional, IsString, IsUrl, Matches } from 'class-validator';

export class CheckStatusDto {
  @IsUrl({ protocols: ['https'], require_protocol: true })
  url: string;

  @IsOptional()
  @IsString()
  @Matches(/^[a-z0-9-]+(\/[a-z0-9-]+)*$/, {
    message:
      'subdirOverride must be a relative path of lowercase, hyphenated segments',
  })
  subdirOverride?: string;
}
