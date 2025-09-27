import { Type } from 'class-transformer';
import {
  IsArray,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Min,
  ValidateNested,
} from 'class-validator';
import {
  WRITING_DESK_JOB_PHASES,
  WRITING_DESK_RESEARCH_STATUSES,
  WritingDeskJobPhase,
  WritingDeskJobResearchStatus,
} from '../writing-desk-jobs.types';

class WritingDeskJobFormDto {
  @IsString()
  issueDetail!: string;

  @IsString()
  affectedDetail!: string;

  @IsString()
  backgroundDetail!: string;

  @IsString()
  desiredOutcome!: string;
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
  @Type(() => WritingDeskJobResearchDto)
  @ValidateNested()
  research?: WritingDeskJobResearchDto;
}

class WritingDeskJobResearchActivityDto {
  @IsString()
  id!: string;

  @IsString()
  type!: string;

  @IsString()
  label!: string;

  @IsString()
  status!: string;

  @IsString()
  createdAt!: string;

  @IsOptional()
  @IsString()
  url?: string | null;
}

class WritingDeskJobResearchDto {
  @IsEnum(WRITING_DESK_RESEARCH_STATUSES)
  status!: WritingDeskJobResearchStatus;

  @IsOptional()
  @IsString()
  startedAt?: string | null;

  @IsOptional()
  @IsString()
  completedAt?: string | null;

  @IsOptional()
  @IsString()
  updatedAt?: string | null;

  @IsOptional()
  @IsString()
  responseId?: string | null;

  @IsOptional()
  @IsString()
  outputText?: string | null;

  @IsOptional()
  @IsInt()
  progress?: number | null;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => WritingDeskJobResearchActivityDto)
  activities?: WritingDeskJobResearchActivityDto[];

  @IsOptional()
  @IsString()
  error?: string | null;

  @IsOptional()
  @IsNumber()
  creditsCharged?: number | null;

  @IsOptional()
  @IsString()
  billedAt?: string | null;
}
