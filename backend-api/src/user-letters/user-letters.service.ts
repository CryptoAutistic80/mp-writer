import { InjectModel } from '@nestjs/mongoose';
import { Injectable, Logger } from '@nestjs/common';
import { Model } from 'mongoose';
import { UserLetter, UserLetterDetail } from './schemas/user-letter.schema';
import { EncryptionService } from '../crypto/encryption.service';

type LetterStatus = 'queued' | 'in_progress' | 'completed' | 'failed';

interface LetterDetailPayload {
  question: string;
  answer: string;
}

interface StartJobPayload {
  userId: string;
  jobId: string;
  status: LetterStatus;
  message: string;
  prompt: string;
  tone?: string;
  details?: LetterDetailPayload[];
  mpName?: string;
  constituency?: string;
  userName?: string;
  userAddressLine?: string;
  credits?: number | null;
}

interface SyncJobPayload {
  userId: string;
  jobId: string;
  status: LetterStatus;
  message?: string | null;
  credits?: number | null;
  error?: string | null;
  content?: string | null | undefined;
  lastResponseId?: string | null;
}

@Injectable()
export class UserLettersService {
  private readonly logger = new Logger(UserLettersService.name);

  constructor(
    @InjectModel(UserLetter.name) private readonly model: Model<UserLetter>,
    private readonly enc: EncryptionService,
  ) {}

  async startJob(payload: StartJobPayload) {
    const now = new Date();
    const normalisedDetails: UserLetterDetail[] = (payload.details || [])
      .map((item) => ({
        question: (item.question || '').trim().slice(0, 500),
        answer: (item.answer || '').trim().slice(0, 2000),
      }))
      .filter((item) => item.question || item.answer);

    const prompt = (payload.prompt || '').trim().slice(0, 8000);
    const tone = (payload.tone || '').trim().slice(0, 255);
    const mpName = (payload.mpName || '').trim().slice(0, 1024);
    const constituency = (payload.constituency || '').trim().slice(0, 1024);
    const userName = (payload.userName || '').trim().slice(0, 1024);
    const userAddressLine = (payload.userAddressLine || '').trim().slice(0, 2048);

    await this.model.updateOne(
      { user: payload.userId, jobId: payload.jobId },
      {
        $set: {
          status: payload.status,
          message: payload.message ?? '',
          prompt,
          tone,
          details: normalisedDetails,
          mpName,
          constituency,
          userName,
          userAddressLine,
          ciphertext: null,
          error: null,
          credits: typeof payload.credits === 'number' ? payload.credits : null,
          lastResponseId: null,
          updatedAt: now,
        },
        $setOnInsert: {
          createdAt: now,
        },
      },
      { upsert: true },
    );
  }

  async syncJobState(payload: SyncJobPayload) {
    const now = new Date();
    const update: Record<string, unknown> = {
      status: payload.status,
      updatedAt: now,
    };

    const setOnInsert: Record<string, unknown> = {
      prompt: '',
      tone: '',
      details: [],
      mpName: '',
      constituency: '',
      userName: '',
      userAddressLine: '',
      ciphertext: null,
      error: payload.error ?? null,
      credits: null,
      lastResponseId: payload.lastResponseId ?? null,
      createdAt: now,
    };

    if (payload.message !== undefined) {
      update.message = payload.message ?? '';
    }

    if (payload.credits !== undefined) {
      update.credits = typeof payload.credits === 'number' ? payload.credits : null;
      delete setOnInsert.credits;
    }

    if (payload.error !== undefined) {
      update.error = payload.error ?? null;
    }

    if (payload.lastResponseId !== undefined) {
      update.lastResponseId = payload.lastResponseId ?? null;
    }

    if (payload.content !== undefined) {
      update.ciphertext = payload.content ? this.enc.encryptObject(payload.content) : null;
    }

    await this.model.updateOne(
      { user: payload.userId, jobId: payload.jobId },
      {
        $set: update,
        $setOnInsert: setOnInsert,
      },
      { upsert: true },
    );
  }

  async getJobStatus(userId: string, jobId: string) {
    const doc = await this.model.findOne({ user: userId, jobId }).lean();
    if (!doc) {
      return null;
    }

    let content: string | undefined;
    if (doc.status === 'completed' && doc.ciphertext) {
      try {
        content = this.enc.decryptObject<string>(doc.ciphertext) || undefined;
      } catch (error) {
        this.logger.error(
          `Failed to decrypt stored letter for job ${jobId}`,
          error instanceof Error ? error.stack : undefined,
        );
      }
    }

    return {
      jobId: doc.jobId,
      status: doc.status as LetterStatus,
      message: doc.message || '',
      credits: typeof doc.credits === 'number' ? doc.credits : undefined,
      updatedAt: doc.updatedAt instanceof Date ? doc.updatedAt.getTime() : Date.now(),
      content,
      error: doc.status === 'failed' ? doc.error || 'Deep research failed.' : undefined,
    };
  }

  async listMine(userId: string, limit = 20) {
    const docs = await this.model
      .find({ user: userId })
      .sort({ updatedAt: -1 })
      .limit(limit)
      .lean();

    return docs.map((doc) => ({
      id: doc._id?.toString?.() ?? '',
      jobId: doc.jobId,
      status: doc.status as LetterStatus,
      message: doc.message || '',
      prompt: doc.prompt || '',
      tone: doc.tone || '',
      mpName: doc.mpName || '',
      constituency: doc.constituency || '',
      hasContent: Boolean(doc.ciphertext),
      credits: typeof doc.credits === 'number' ? doc.credits : null,
      updatedAt: doc.updatedAt instanceof Date ? doc.updatedAt.toISOString() : new Date().toISOString(),
      createdAt: doc.createdAt instanceof Date ? doc.createdAt.toISOString() : new Date().toISOString(),
    }));
  }

  async getMineById(userId: string, id: string) {
    const doc = await this.model.findOne({ _id: id, user: userId }).lean();
    if (!doc) {
      return null;
    }

    let content: string | null = null;
    if (doc.ciphertext) {
      try {
        content = this.enc.decryptObject<string>(doc.ciphertext);
      } catch (error) {
        this.logger.error(
          `Failed to decrypt stored letter ${id}`,
          error instanceof Error ? error.stack : undefined,
        );
      }
    }

    return {
      id: doc._id?.toString?.() ?? '',
      jobId: doc.jobId,
      status: doc.status as LetterStatus,
      message: doc.message || '',
      prompt: doc.prompt || '',
      tone: doc.tone || '',
      details: (doc.details || []).map((item) => ({
        question: item.question || '',
        answer: item.answer || '',
      })),
      mpName: doc.mpName || '',
      constituency: doc.constituency || '',
      userName: doc.userName || '',
      userAddressLine: doc.userAddressLine || '',
      content,
      error: doc.error || null,
      credits: typeof doc.credits === 'number' ? doc.credits : null,
      createdAt: doc.createdAt instanceof Date ? doc.createdAt.toISOString() : new Date().toISOString(),
      updatedAt: doc.updatedAt instanceof Date ? doc.updatedAt.toISOString() : new Date().toISOString(),
    };
  }
}

