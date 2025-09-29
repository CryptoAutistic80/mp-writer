import { IsBoolean, IsEnum, IsOptional, IsString } from 'class-validator';
import { WRITING_DESK_LETTER_TONES, WritingDeskLetterTone } from '../writing-desk-jobs.types';

export class StartLetterDto {
  @IsString()
  @IsOptional()
  jobId?: string;

  @IsEnum(WRITING_DESK_LETTER_TONES)
  tone!: WritingDeskLetterTone;

  @IsBoolean()
  @IsOptional()
  resume?: boolean;
}

