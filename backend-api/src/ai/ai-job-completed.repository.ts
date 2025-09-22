import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { AiJobCompleted, AiJobCompletedDocument } from './schemas/ai-job-completed.schema';
import { AiJobDetail } from './schemas/ai-job.schema';

export type AiJobCompletedLean = Omit<AiJobCompletedDocument, 'save' | 'validate'> & {
  _id: Types.ObjectId;
};

@Injectable()
export class AiJobCompletedRepository {
  constructor(@InjectModel(AiJobCompleted.name) private readonly completedModel: Model<AiJobCompleted>) {}

  async recordCompletion(payload: {
    jobId: string;
    userId: string;
    status: 'completed' | 'failed';
    message: string;
    credits: number | null;
    prompt: string | null;
    model: string | null;
    tone: string | null;
    details: AiJobDetail[];
    mpName: string | null;
    constituency: string | null;
    userName: string | null;
    userAddressLine: string | null;
    content: string | null;
    error: string | null;
    completedAt: Date;
  }): Promise<void> {
    await this.completedModel
      .findOneAndUpdate(
        { jobId: payload.jobId },
        {
          $set: {
            jobId: payload.jobId,
            user: payload.userId,
            status: payload.status,
            message: payload.message,
            credits: payload.credits ?? null,
            prompt: payload.prompt,
            model: payload.model,
            tone: payload.tone,
            details: payload.details,
            mpName: payload.mpName,
            constituency: payload.constituency,
            userName: payload.userName,
            userAddressLine: payload.userAddressLine,
            content: payload.content,
            error: payload.error,
            completedAt: payload.completedAt,
          },
        },
        { upsert: true, new: true, setDefaultsOnInsert: true },
      )
      .lean<AiJobCompletedLean>()
      .exec();
  }

  async findByJobId(jobId: string): Promise<AiJobCompletedLean | null> {
    return this.completedModel.findOne({ jobId }).lean<AiJobCompletedLean>().exec();
  }
}
