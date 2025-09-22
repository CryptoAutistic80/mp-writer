import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ConfigModule } from '@nestjs/config';
import { AiService } from './ai.service';
import { AiController } from './ai.controller';
import { UserCreditsModule } from '../user-credits/user-credits.module';
import { UserMpModule } from '../user-mp/user-mp.module';
import { UserAddressModule } from '../user-address-store/user-address.module';
import { AiJob, AiJobSchema } from './schemas/ai-job.schema';
import { AiJobCompleted, AiJobCompletedSchema } from './schemas/ai-job-completed.schema';
import { AiJobRepository } from './ai-job.repository';
import { AiJobCompletedRepository } from './ai-job-completed.repository';

@Module({
  imports: [
    ConfigModule,
    UserCreditsModule,
    UserMpModule,
    UserAddressModule,
    MongooseModule.forFeature([
      { name: AiJob.name, schema: AiJobSchema },
      { name: AiJobCompleted.name, schema: AiJobCompletedSchema },
    ]),
  ],
  controllers: [AiController],
  providers: [AiService, AiJobRepository, AiJobCompletedRepository],
})
export class AiModule {}

