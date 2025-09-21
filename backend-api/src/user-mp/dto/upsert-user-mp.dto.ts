import { IsInt, IsNotEmpty, IsOptional, IsString, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

class MpDto {
  @IsOptional()
  @IsInt()
  id?: number;

  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  party?: string;

  @IsOptional()
  @IsString()
  portraitUrl?: string;

  @IsOptional()
  @IsString()
  since?: string;

  @IsOptional()
  @IsString()
  email?: string;

  @IsOptional()
  @IsString()
  twitter?: string;

  @IsOptional()
  @IsString()
  website?: string;

  @IsOptional()
  @IsString()
  parliamentaryAddress?: string;
}

export class UpsertUserMpDto {
  @IsString()
  @IsNotEmpty()
  constituency!: string;

  @ValidateNested()
  @Type(() => MpDto)
  @IsOptional()
  mp?: MpDto | null;
}

