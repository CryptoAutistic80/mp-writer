import { IsIn, IsInt, IsNotEmpty, IsOptional, IsPositive, IsString } from 'class-validator';

export class CreatePurchaseDto {
  @IsString()
  @IsNotEmpty()
  plan!: string;

  @IsInt()
  @IsPositive()
  amount!: number;

  @IsString()
  @IsOptional()
  currency?: string = 'usd';

  @IsInt()
  @IsPositive()
  credits!: number;

  @IsOptional()
  metadata?: Record<string, any>;

  @IsOptional()
  @IsIn(['pending', 'succeeded', 'failed', 'refunded'])
  status?: 'pending' | 'succeeded' | 'failed' | 'refunded';
}

