import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { AiJob, AiJobDocument, AiJobStatus } from './schemas/ai-job.schema';
import { FollowUpDetailDto } from './dto/generate.dto';

export interface AiJobSnapshot {
  jobId: string;
  userId: string;
  status: AiJobStatus;
  message: string;
  prompt: string;
  tone?: string;
  details: FollowUpDetailDto[];
  mpName?: string;
  constituency?: string;
  userName?: string;
  userAddressLine?: string;
  content?: string | null;
  error?: string | null;
  credits?: number;
  lastResponseId?: string | null;
  createdAt: number;
  updatedAt: number;
  completedAt?: number | null;
}

export interface CreateAiJobOptions {
  jobId: string;
  userId: string;
  status: AiJobStatus;
  message: string;
  prompt: string;
  tone?: string;
  details?: FollowUpDetailDto[];
  mpName?: string;
  constituency?: string;
  userName?: string;
  userAddressLine?: string;
  credits?: number;
}

export interface UpdateAiJobOptions {
  status?: AiJobStatus;
  message?: string;
  content?: string | null;
  error?: string | null;
  credits?: number;
  lastResponseId?: string | null;
  completedAt?: number | null;
}

export interface AiLetterSummary {
  jobId: string;
  prompt: string;
  mpName?: string;
  constituency?: string;
  tone?: string;
  createdAt: number;
  updatedAt: number;
}

export interface AiLetterDetail extends AiLetterSummary {
  content: string;
}

@Injectable()
export class AiJobStoreService {
  constructor(
    @InjectModel(AiJob.name) private readonly model: Model<AiJobDocument>,
  ) {}

  async create(options: CreateAiJobOptions): Promise<AiJobSnapshot> {
    const doc = await this.model.create({
      jobId: options.jobId,
      user: options.userId,
      status: options.status,
      message: options.message,
      prompt: options.prompt,
      tone: options.tone,
      details: (options.details ?? []).map((item) => ({
        question: item.question,
        answer: item.answer,
      })),
      mpName: options.mpName,
      constituency: options.constituency,
      userName: options.userName,
      userAddressLine: options.userAddressLine,
      credits: options.credits,
    });
    return this.toSnapshot(doc);
  }

  async update(jobId: string, patch: UpdateAiJobOptions): Promise<void> {
    const update: Record<string, any> = {};
    if (patch.status) update.status = patch.status;
    if (patch.message !== undefined) update.message = patch.message;
    if (patch.content !== undefined) update.content = patch.content;
    if (patch.error !== undefined) update.error = patch.error;
    if (patch.credits !== undefined) update.credits = patch.credits;
    if (patch.lastResponseId !== undefined) update.lastResponseId = patch.lastResponseId;
    if (patch.completedAt !== undefined)
      update.completedAt = patch.completedAt ? new Date(patch.completedAt) : null;

    if (Object.keys(update).length === 0) return;

    await this.model.updateOne({ jobId }, { $set: update }).exec();
  }

  async findForUser(jobId: string, userId: string): Promise<AiJobSnapshot | null> {
    const doc = await this.model.findOne({ jobId, user: userId }).lean();
    if (!doc) return null;
    return this.toSnapshot(doc);
  }

  async findActiveForUser(userId: string): Promise<AiJobSnapshot | null> {
    const doc = await this.model
      .findOne({ user: userId, status: { $in: ['queued', 'in_progress'] } })
      .sort({ updatedAt: -1 })
      .lean();
    if (!doc) return null;
    return this.toSnapshot(doc);
  }

  async listLetters(userId: string, limit = 20): Promise<AiLetterSummary[]> {
    const docs = await this.model
      .find({ user: userId, status: 'completed', content: { $exists: true, $ne: null } })
      .sort({ updatedAt: -1 })
      .limit(limit)
      .select({
        jobId: 1,
        prompt: 1,
        mpName: 1,
        constituency: 1,
        tone: 1,
        createdAt: 1,
        updatedAt: 1,
      })
      .lean();
    return docs.map((doc) => ({
      jobId: doc.jobId,
      prompt: doc.prompt,
      mpName: doc.mpName,
      constituency: doc.constituency,
      tone: doc.tone,
      createdAt: this.toMillis(doc.createdAt),
      updatedAt: this.toMillis(doc.updatedAt),
    }));
  }

  async getLetter(jobId: string, userId: string): Promise<AiLetterDetail | null> {
    const doc = await this.model
      .findOne({ jobId, user: userId, status: 'completed', content: { $exists: true, $ne: null } })
      .lean();
    if (!doc || !doc.content) return null;
    return {
      jobId: doc.jobId,
      prompt: doc.prompt,
      mpName: doc.mpName,
      constituency: doc.constituency,
      tone: doc.tone,
      createdAt: this.toMillis(doc.createdAt),
      updatedAt: this.toMillis(doc.updatedAt),
      content: doc.content,
    };
  }

  private toSnapshot(doc: AiJob | AiJobDocument | (AiJob & { _id: any }) | any): AiJobSnapshot {
    return {
      jobId: doc.jobId,
      userId: doc.user?.toString?.() ?? doc.user,
      status: doc.status,
      message: doc.message,
      prompt: doc.prompt,
      tone: doc.tone,
      details: Array.isArray(doc.details)
        ? doc.details.map((item: any) => ({ question: item.question, answer: item.answer }))
        : [],
      mpName: doc.mpName,
      constituency: doc.constituency,
      userName: doc.userName,
      userAddressLine: doc.userAddressLine,
      content: doc.content,
      error: doc.error,
      credits: doc.credits,
      lastResponseId: doc.lastResponseId,
      createdAt: this.toMillis(doc.createdAt),
      updatedAt: this.toMillis(doc.updatedAt),
      completedAt: doc.completedAt ? this.toMillis(doc.completedAt) : null,
    };
  }

  private toMillis(value: Date | string | number | undefined): number {
    if (!value) return Date.now();
    if (value instanceof Date) return value.getTime();
    const parsed = new Date(value);
    return Number.isFinite(parsed.getTime()) ? parsed.getTime() : Date.now();
  }
}
