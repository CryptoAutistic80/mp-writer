import { IsBoolean, IsOptional } from 'class-validator';

export class RunResearchDto {
  @IsOptional()
  @IsBoolean()
  force?: boolean;
}
