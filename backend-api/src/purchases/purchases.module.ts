import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ConfigModule } from '@nestjs/config';
import { PurchasesService } from './purchases.service';
import { PurchasesController } from './purchases.controller';
import { Purchase, PurchaseSchema } from './schemas/purchase.schema';
import { PurchasesWebhookController } from './purchases-webhook.controller';
import { UserCreditsModule } from '../user-credits/user-credits.module';

@Module({
  imports: [
    ConfigModule,
    UserCreditsModule,
    MongooseModule.forFeature([{ name: Purchase.name, schema: PurchaseSchema }]),
  ],
  controllers: [PurchasesController, PurchasesWebhookController],
  providers: [PurchasesService],
})
export class PurchasesModule {}

