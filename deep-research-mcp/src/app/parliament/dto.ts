import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  Max,
  Matches,
  MaxLength,
  Min,
} from 'class-validator';

type TrimmedString = string;

const trim = ({ value }: { value: TrimmedString }) =>
  typeof value === 'string' ? value.trim() : value;

const toBoolean = ({ value }: { value: unknown }) => {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    return value.toLowerCase() === 'true' || value === '1';
  }
  return Boolean(value);
};

export class SearchOptionsDto {
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  enableCache?: boolean;

  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  fuzzyMatch?: boolean;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(1)
  relevanceThreshold?: number;

  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  applyRelevance?: boolean;
}

export class CoreDatasetQueryDto extends SearchOptionsDto {
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

export class BillSearchDto extends SearchOptionsDto {
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

export class HistoricHansardQueryDto extends SearchOptionsDto {
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

export class LegislationSearchDto extends SearchOptionsDto {
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
