import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';

export class FollowUpContextDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(1000)
  id!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(1000)
  prompt!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(4000)
  answer!: string;
}

export class GenerateFollowupsDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(4000)
  issueSummary!: string;

  @IsArray()
  @ArrayMaxSize(10)
  @ValidateNested({ each: true })
  @Type(() => FollowUpContextDto)
  contextAnswers!: FollowUpContextDto[];

  @IsString()
  @IsOptional()
  @MaxLength(200)
  mpName?: string;

  @IsString()
  @IsOptional()
  @MaxLength(200)
  constituency?: string;
}
