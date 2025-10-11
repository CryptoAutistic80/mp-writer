import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { WRITING_DESK_LETTER_TONES } from '../../writing-desk-jobs/writing-desk-jobs.types';

class StoredLetterMetadataDto {
  @IsOptional()
  @IsString()
  @MaxLength(256)
  mpName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(256)
  mpAddress1?: string;

  @IsOptional()
  @IsString()
  @MaxLength(256)
  mpAddress2?: string;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  mpCity?: string;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  mpCounty?: string;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  mpPostcode?: string;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  date?: string;

  @IsOptional()
  @IsString()
  @MaxLength(256)
  senderName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(256)
  senderAddress1?: string;

  @IsOptional()
  @IsString()
  @MaxLength(256)
  senderAddress2?: string;

  @IsOptional()
  @IsString()
  @MaxLength(256)
  senderAddress3?: string;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  senderCity?: string;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  senderCounty?: string;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  senderPostcode?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  senderTelephone?: string;
}

export class CreateUserStoredLetterDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(200000)
  letterHtml!: string;

  @IsOptional()
  @IsString()
  @MaxLength(200000)
  letterJson?: string;

  @IsOptional()
  @IsString()
  @MaxLength(256)
  jobId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(256)
  responseId?: string;

  @IsOptional()
  @IsIn(WRITING_DESK_LETTER_TONES)
  tone?: string | null;

  @IsArray()
  @ArrayMaxSize(100)
  @ArrayMinSize(0)
  @IsString({ each: true })
  references!: string[];

  @ValidateNested()
  @Type(() => StoredLetterMetadataDto)
  metadata!: StoredLetterMetadataDto;
}
