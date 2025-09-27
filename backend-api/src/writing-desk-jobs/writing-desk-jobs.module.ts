import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { WritingDeskJobsController } from './writing-desk-jobs.controller';
import { WritingDeskJobsService } from './writing-desk-jobs.service';
import { WritingDeskJobsRepository } from './writing-desk-jobs.repository';
import { WritingDeskJob, WritingDeskJobSchema } from './schema/writing-desk-job.schema';
import { EncryptionService } from '../crypto/encryption.service';
import { UserCreditsModule } from '../user-credits/user-credits.module';

@Module({
  imports: [
    ConfigModule,
    UserCreditsModule,
    MongooseModule.forFeature([{ name: WritingDeskJob.name, schema: WritingDeskJobSchema }]),
  ],
  controllers: [WritingDeskJobsController],
  providers: [WritingDeskJobsService, WritingDeskJobsRepository, EncryptionService],
  exports: [WritingDeskJobsService],
})
export class WritingDeskJobsModule {}
