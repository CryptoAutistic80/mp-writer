import { ArrayMaxSize, IsArray, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

export class TransformDto {
  @IsString()
  @IsNotEmpty()
  letterHtml!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  mpName!: string;

  @IsString()
  @IsOptional()
  @MaxLength(200)
  constituency?: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  senderName!: string;

  @IsArray()
  @ArrayMaxSize(5)
  @IsString({ each: true })
  senderAddressLines!: string[];

  @IsString()
  @IsOptional()
  @MaxLength(100)
  tone?: string;

  @IsString()
  @IsOptional()
  @MaxLength(50)
  date?: string;
}
