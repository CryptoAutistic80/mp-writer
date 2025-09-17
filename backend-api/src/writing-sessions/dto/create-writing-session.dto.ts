import { IsNotEmpty, IsString, MaxLength, MinLength } from 'class-validator';

export class CreateWritingSessionDto {
  @IsString()
  @IsNotEmpty()
  @MinLength(20)
  @MaxLength(5000)
  brief!: string;
}
