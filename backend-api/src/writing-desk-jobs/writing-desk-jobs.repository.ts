import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { WritingDeskJob, WritingDeskJobDocument } from './schema/writing-desk-job.schema';
import { WritingDeskJobRecord, WritingDeskJobPhase } from './writing-desk-jobs.types';

@Injectable()
export class WritingDeskJobsRepository {
  constructor(
    @InjectModel(WritingDeskJob.name)
    private readonly model: Model<WritingDeskJobDocument>,
  ) {}

  async findActiveByUserId(userId: string): Promise<WritingDeskJobRecord | null> {
    const doc = await this.model.findOne({ userId }).lean();
    return doc ? (doc as unknown as WritingDeskJobRecord) : null;
  }

  async upsertActiveJob(
    userId: string,
    payload: {
      jobId: string;
      phase: WritingDeskJobPhase;
      stepIndex: number;
      followUpIndex: number;
      followUpQuestions: string[];
      formCiphertext: string;
      followUpAnswersCiphertext: string;
      notes: string | null;
      responseId: string | null;
    },
  ): Promise<WritingDeskJobRecord> {
    const doc = await this.model
      .findOneAndUpdate(
        { userId },
        {
          $set: {
            ...payload,
            userId,
          },
          $unset: { form: '', followUpAnswers: '' },
        },
        { new: true, upsert: true, setDefaultsOnInsert: true }
      )
      .lean();
    return doc as unknown as WritingDeskJobRecord;
  }

  async deleteActiveJob(userId: string): Promise<void> {
    await this.model.deleteOne({ userId });
  }
}
