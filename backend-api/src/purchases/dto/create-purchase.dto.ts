import { IsIn, IsInt, IsNotEmpty, IsOptional, IsPositive, IsString } from 'class-validator';
import { PURCHASE_PLANS } from '../purchase-plans';

export class CreatePurchaseDto {
  @IsString()
  @IsNotEmpty()
  @IsIn(Object.keys(PURCHASE_PLANS))
  plan!: string;

  @IsInt()
  @IsPositive()
  @IsOptional()
  amount?: number;

  @IsString()
  @IsOptional()
  currency?: string;

  @IsOptional()
  metadata?: Record<string, any>;
}

