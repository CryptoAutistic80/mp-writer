import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { AiService } from './ai.service';
import { AiController } from './ai.controller';
import { UserCreditsModule } from '../user-credits/user-credits.module';
import { UserMpModule } from '../user-mp/user-mp.module';
import { UserAddressModule } from '../user-address-store/user-address.module';
import { AiJob, AiJobSchema } from './schemas/ai-job.schema';
import { AiJobStoreService } from './ai-job-store.service';

@Module({
  imports: [
    ConfigModule,
    UserCreditsModule,
    UserMpModule,
    UserAddressModule,
    MongooseModule.forFeature([{ name: AiJob.name, schema: AiJobSchema }]),
  ],
  controllers: [AiController],
  providers: [AiService, AiJobStoreService],
})
export class AiModule {}

