import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { AiJob, AiJobDocument, AiJobDetail } from './schemas/ai-job.schema';

export type AiJobLean = Omit<AiJobDocument, 'save' | 'validate'> & {
  _id: Types.ObjectId;
};

@Injectable()
export class AiJobRepository {
  constructor(@InjectModel(AiJob.name) private readonly jobModel: Model<AiJob>) {}

  async findByUser(userId: string): Promise<AiJobLean | null> {
    return this.jobModel.findOne({ user: userId }).lean<AiJobLean>().exec();
  }

  async findByJobId(jobId: string): Promise<AiJobLean | null> {
    return this.jobModel.findOne({ jobId }).lean<AiJobLean>().exec();
  }

  async createOrReplace(
    userId: string,
    jobId: string,
    payload: {
      message: string;
      status: 'queued' | 'in_progress';
      credits: number | null;
      prompt: string;
      model?: string;
      tone?: string;
      details?: AiJobDetail[];
      mpName?: string;
      constituency?: string;
      userName?: string;
      userAddressLine?: string;
    },
  ): Promise<AiJobLean> {
    const update = {
      jobId,
      user: userId,
      status: payload.status,
      message: payload.message,
      credits: payload.credits ?? null,
      prompt: payload.prompt,
      model: payload.model ?? null,
      tone: payload.tone ?? null,
      details: payload.details ?? [],
      mpName: payload.mpName ?? null,
      constituency: payload.constituency ?? null,
      userName: payload.userName ?? null,
      userAddressLine: payload.userAddressLine ?? null,
      content: null,
      error: null,
      lastResponseId: null,
    };

    return this.jobModel
      .findOneAndUpdate(
        { user: userId },
        { $set: update },
        { new: true, upsert: true, setDefaultsOnInsert: true },
      )
      .lean<AiJobLean>()
      .exec();
  }

  async updateJob(jobId: string, patch: Partial<AiJob>): Promise<AiJobLean | null> {
    return this.jobModel
      .findOneAndUpdate(
        { jobId },
        { $set: patch },
        { new: true },
      )
      .lean<AiJobLean>()
      .exec();
  }
}
