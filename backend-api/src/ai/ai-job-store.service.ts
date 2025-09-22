import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { AiJob, AiJobDocument, AiJobStatus } from './schemas/ai-job.schema';
import { FollowUpDetailDto } from './dto/generate.dto';
import { EncryptionService } from '../crypto/encryption.service';

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
  private readonly logger = new Logger(AiJobStoreService.name);

  constructor(
    @InjectModel(AiJob.name) private readonly model: Model<AiJobDocument>,
    private readonly enc: EncryptionService,
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
    const setUpdate: Record<string, any> = {};
    const unsetUpdate: Record<string, any> = {};

    if (patch.status) setUpdate.status = patch.status;
    if (patch.message !== undefined) setUpdate.message = patch.message;
    if (patch.error !== undefined) setUpdate.error = patch.error;
    if (patch.credits !== undefined) setUpdate.credits = patch.credits;
    if (patch.lastResponseId !== undefined) setUpdate.lastResponseId = patch.lastResponseId;
    if (patch.completedAt !== undefined)
      setUpdate.completedAt = patch.completedAt ? new Date(patch.completedAt) : null;

    if (patch.content !== undefined) {
      if (patch.content === null) {
        setUpdate.contentCiphertext = null;
      } else {
        setUpdate.contentCiphertext = this.enc.encryptObject({ content: patch.content });
      }
      unsetUpdate.content = '';
    }

    const updateOps: Record<string, any> = {};
    if (Object.keys(setUpdate).length > 0) updateOps.$set = setUpdate;
    if (Object.keys(unsetUpdate).length > 0) updateOps.$unset = unsetUpdate;

    if (Object.keys(updateOps).length === 0) return;

    await this.model.updateOne({ jobId }, updateOps).exec();
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
      .find({
        user: userId,
        status: 'completed',
        $or: [
          { contentCiphertext: { $exists: true, $ne: null } },
          { content: { $exists: true, $ne: null } },
        ],
      })
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
      .findOne({
        jobId,
        user: userId,
        status: 'completed',
        $or: [
          { contentCiphertext: { $exists: true, $ne: null } },
          { content: { $exists: true, $ne: null } },
        ],
      })
      .lean();
    if (!doc) return null;
    const content = this.decryptContent(doc);
    if (content === null) return null;
    return {
      jobId: doc.jobId,
      prompt: doc.prompt,
      mpName: doc.mpName,
      constituency: doc.constituency,
      tone: doc.tone,
      createdAt: this.toMillis(doc.createdAt),
      updatedAt: this.toMillis(doc.updatedAt),
      content,
    };
  }

  private toSnapshot(doc: AiJob | AiJobDocument | (AiJob & { _id: any }) | any): AiJobSnapshot {
    const content = this.decryptContent(doc);
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
      content,
      error: doc.error,
      credits: doc.credits,
      lastResponseId: doc.lastResponseId,
      createdAt: this.toMillis(doc.createdAt),
      updatedAt: this.toMillis(doc.updatedAt),
      completedAt: doc.completedAt ? this.toMillis(doc.completedAt) : null,
    };
  }

  private decryptContent(doc: any): string | null {
    const ciphertext = doc.contentCiphertext;
    if (typeof ciphertext === 'string' && ciphertext.length > 0) {
      try {
        const payload = this.enc.decryptObject<{ content?: string }>(ciphertext);
        if (payload && typeof payload.content === 'string') {
          return payload.content;
        }
        return null;
      } catch (error) {
        this.logger.warn(`Failed to decrypt AI letter content for job ${doc.jobId}: ${error}`);
        return null;
      }
    }

    if (typeof doc.content === 'string' && doc.content.length > 0) {
      return doc.content;
    }

    return null;
  }

  private toMillis(value: Date | string | number | undefined): number {
    if (!value) return Date.now();
    if (value instanceof Date) return value.getTime();
    const parsed = new Date(value);
    return Number.isFinite(parsed.getTime()) ? parsed.getTime() : Date.now();
  }
}
