import { Module, forwardRef } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ConfigModule } from '@nestjs/config';
import { UserCredits, UserCreditsSchema } from './schemas/user-credits.schema';
import { UserCreditsService } from './user-credits.service';
import { UserCreditsController } from './user-credits.controller';
import { StripeModule } from '../payments/stripe/stripe.module';

@Module({
  imports: [
    ConfigModule,
    forwardRef(() => StripeModule),
    MongooseModule.forFeature([{ name: UserCredits.name, schema: UserCreditsSchema }]),
  ],
  providers: [UserCreditsService],
  controllers: [UserCreditsController],
  exports: [UserCreditsService, MongooseModule],
})
export class UserCreditsModule {}
