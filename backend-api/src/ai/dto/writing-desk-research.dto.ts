import {
  IsArray,
  IsOptional,
  IsString,
  IsUUID,
} from 'class-validator';

export class WritingDeskResearchDto {
  @IsOptional()
  @IsUUID()
  jobId?: string;

  @IsString()
  issueDetail!: string;

  @IsString()
  affectedDetail!: string;

  @IsString()
  backgroundDetail!: string;

  @IsString()
  desiredOutcome!: string;

  @IsArray()
  @IsString({ each: true })
  followUpQuestions!: string[];

  @IsArray()
  @IsString({ each: true })
  followUpAnswers!: string[];

  @IsOptional()
  @IsString()
  notes?: string | null;

  @IsOptional()
  @IsString()
  responseId?: string | null;
}
