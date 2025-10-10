import { Transform, Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsPositive,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';

type TrimmedString = string;

const trim = ({ value }: { value: TrimmedString }) =>
  typeof value === 'string' ? value.trim() : value;

export class CoreDatasetQueryDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  @Transform(trim)
  dataset!: string;

  @IsOptional()
  @IsString()
  @MaxLength(256)
  @Transform(trim)
  searchTerm?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @IsPositive()
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @IsPositive()
  perPage?: number;
}

export enum ParliamentaryHouse {
  Commons = 'commons',
  Lords = 'lords',
}

export class BillSearchDto {
  @IsOptional()
  @IsString()
  @MaxLength(256)
  @Transform(trim)
  searchTerm?: string;

  @IsOptional()
  @IsEnum(ParliamentaryHouse)
  house?: ParliamentaryHouse;

  @IsOptional()
  @IsString()
  @MaxLength(16)
  @Transform(trim)
  session?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @IsPositive()
  parliamentNumber?: number;
}

export class HistoricHansardQueryDto {
  @IsEnum(ParliamentaryHouse)
  house!: ParliamentaryHouse;

  @IsString()
  @IsNotEmpty()
  @MaxLength(512)
  @Transform(trim)
  @Matches(/^[a-z0-9\-/]+$/i, {
    message: 'path may only contain alphanumeric characters, dashes, and slashes',
  })
  path!: string;
}

export enum LegislationDocumentType {
  All = 'all',
  Ukpga = 'ukpga',
  Ukci = 'ukci',
  Ukla = 'ukla',
  Nisi = 'nisi',
}

export class LegislationSearchDto {
  @IsOptional()
  @IsString()
  @MaxLength(256)
  @Transform(trim)
  title?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @IsPositive()
  year?: number;

  @IsOptional()
  @IsEnum(LegislationDocumentType)
  type?: LegislationDocumentType;
}
