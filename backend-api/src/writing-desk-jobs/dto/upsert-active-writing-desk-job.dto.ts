import { Type } from 'class-transformer';
import {
  IsArray,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Min,
  ValidateNested,
} from 'class-validator';
import {
  WRITING_DESK_JOB_PHASES,
  WRITING_DESK_RESEARCH_STATUSES,
  WRITING_DESK_LETTER_STATUSES,
  WRITING_DESK_LETTER_TONES,
  WritingDeskJobPhase,
  WritingDeskResearchStatus,
  WritingDeskLetterStatus,
  WritingDeskLetterTone,
} from '../writing-desk-jobs.types';

class WritingDeskJobFormDto {
  @IsString()
  issueDescription!: string;
}

export class UpsertActiveWritingDeskJobDto {
  @IsOptional()
  @IsUUID()
  jobId?: string;

  @IsEnum(WRITING_DESK_JOB_PHASES)
  phase!: WritingDeskJobPhase;

  @Type(() => WritingDeskJobFormDto)
  @ValidateNested()
  form!: WritingDeskJobFormDto;

  @IsInt()
  @Min(0)
  stepIndex!: number;

  @IsInt()
  @Min(0)
  followUpIndex!: number;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  followUpQuestions?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  followUpAnswers?: string[];

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  responseId?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  notes?: string;

  @IsOptional()
  @IsString()
  researchContent?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  researchResponseId?: string;

  @IsOptional()
  @IsEnum(WRITING_DESK_RESEARCH_STATUSES)
  researchStatus?: WritingDeskResearchStatus;

  @IsOptional()
  @IsEnum(WRITING_DESK_LETTER_TONES)
  letterTone?: WritingDeskLetterTone;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  letterContent?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  letterResponseId?: string;

  @IsOptional()
  @IsEnum(WRITING_DESK_LETTER_STATUSES)
  letterStatus?: WritingDeskLetterStatus;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  letterReferences?: string[];

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  letterResult?: string;
}
