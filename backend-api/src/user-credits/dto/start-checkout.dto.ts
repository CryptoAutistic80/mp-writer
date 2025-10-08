import { IsString, IsNotEmpty } from 'class-validator';

export class StartCheckoutDto {
  @IsString()
  @IsNotEmpty()
  packageId!: string;
}
