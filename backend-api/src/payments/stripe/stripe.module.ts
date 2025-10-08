import { Module, forwardRef } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { StripeService } from './stripe.service';
import { StripeController } from './stripe.controller';
import { PurchasesModule } from '../../purchases/purchases.module';
import { UserCreditsModule } from '../../user-credits/user-credits.module';

@Module({
  imports: [ConfigModule, PurchasesModule, forwardRef(() => UserCreditsModule)],
  providers: [StripeService],
  controllers: [StripeController],
  exports: [StripeService],
})
export class StripeModule {}
