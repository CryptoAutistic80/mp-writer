import { IsString, IsNotEmpty } from 'class-validator';

export class CreateCheckoutSessionDto {
  @IsString()
  @IsNotEmpty()
  packageId!: string;
}
