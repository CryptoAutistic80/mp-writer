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

export class GenerateDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(4000)
  prompt!: string;

  @IsString()
  @IsOptional()
  model?: string;

  @IsString()
  @IsOptional()
  tone?: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => FollowUpDetailDto)
  details?: FollowUpDetailDto[];

  @IsString()
  @IsOptional()
  mpName?: string;

  @IsString()
  @IsOptional()
  constituency?: string;

  @IsString()
  @IsOptional()
  userName?: string;

  @IsString()
  @IsOptional()
  userAddressLine?: string;
}

