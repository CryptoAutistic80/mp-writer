import { Type } from 'class-transformer';
import {
  IsArray,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';

export class FollowUpDetailDto {
  @IsString()
  @IsNotEmpty()
  question!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(1000)
  answer!: string;
}

export class BaseAnswerDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  questionId!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(512)
  prompt!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  answer!: string;
}

export class FollowupAnswerDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  questionId!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  answer!: string;
}

export class GenerateFollowupsDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(4000)
  issueSummary!: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => BaseAnswerDto)
  baseAnswers!: BaseAnswerDto[];
}

export class ResearchPromptDto extends GenerateFollowupsDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => FollowupAnswerDto)
  @IsOptional()
  followupAnswers?: FollowupAnswerDto[];

  @IsString()
  @IsOptional()
  @MaxLength(120)
  tone?: string;
}

export class DeepResearchDto extends ResearchPromptDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(8000)
  researchPrompt!: string;

  @IsString()
  @IsOptional()
  @MaxLength(200)
  mpName?: string;

  @IsString()
  @IsOptional()
  @MaxLength(200)
  constituency?: string;

  @IsString()
  @IsOptional()
  @MaxLength(200)
  userName?: string;

  @IsString()
  @IsOptional()
  @MaxLength(2000)
  userAddressHtml?: string;
}

export class ComposeLetterDto extends ResearchPromptDto {
  @IsString()
  @IsNotEmpty()
  jobId!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(16000)
  researchSummary!: string;

  @IsString()
  @IsOptional()
  @MaxLength(200)
  mpName?: string;

  @IsString()
  @IsOptional()
  @MaxLength(200)
  constituency?: string;

  @IsString()
  @IsOptional()
  @MaxLength(200)
  userName?: string;

  @IsString()
  @IsOptional()
  @MaxLength(2000)
  userAddressHtml?: string;
}
