import { Module, forwardRef } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { WritingDeskJobsController } from './writing-desk-jobs.controller';
import { WritingDeskJobsService } from './writing-desk-jobs.service';
import { WritingDeskJobsRepository } from './writing-desk-jobs.repository';
import { WritingDeskJob, WritingDeskJobSchema } from './schema/writing-desk-job.schema';
import { EncryptionService } from '../crypto/encryption.service';
import { AiModule } from '../ai/ai.module';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: WritingDeskJob.name, schema: WritingDeskJobSchema }]),
    forwardRef(() => AiModule),
  ],
  controllers: [WritingDeskJobsController],
  providers: [WritingDeskJobsService, WritingDeskJobsRepository, EncryptionService],
  exports: [WritingDeskJobsService],
})
export class WritingDeskJobsModule {}
