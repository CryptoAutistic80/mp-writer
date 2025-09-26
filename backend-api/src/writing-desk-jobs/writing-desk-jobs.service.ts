import { Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { UpsertActiveWritingDeskJobDto } from './dto/upsert-active-writing-desk-job.dto';
import { WritingDeskJobsRepository } from './writing-desk-jobs.repository';
import {
  ActiveWritingDeskJobResource,
  WritingDeskJobSnapshot,
  WritingDeskJobFormSnapshot,
  WritingDeskJobRecord,
} from './writing-desk-jobs.types';
import { EncryptionService } from '../crypto/encryption.service';

@Injectable()
export class WritingDeskJobsService {
  constructor(
    private readonly repository: WritingDeskJobsRepository,
    private readonly encryption: EncryptionService,
  ) {}

  async getActiveJobForUser(userId: string): Promise<ActiveWritingDeskJobResource | null> {
    const record = await this.repository.findActiveByUserId(userId);
    if (!record) return null;
    const snapshot = this.toSnapshot(record);
    return this.toResource(snapshot);
  }

  async upsertActiveJob(
    userId: string,
    input: UpsertActiveWritingDeskJobDto,
  ): Promise<ActiveWritingDeskJobResource> {
    const existing = await this.repository.findActiveByUserId(userId);
    const sanitized = this.sanitiseInput(input);
    const nextJobId = this.resolveJobId(existing, input.jobId);
    const payload = {
      jobId: nextJobId,
      phase: sanitized.phase,
      stepIndex: sanitized.stepIndex,
      followUpIndex: sanitized.followUpIndex,
      followUpQuestions: sanitized.followUpQuestions,
      formCiphertext: this.encryption.encryptObject(sanitized.form),
      followUpAnswersCiphertext: this.encryption.encryptObject(sanitized.followUpAnswers),
      notes: sanitized.notes,
      responseId: sanitized.responseId,
    };

    const saved = await this.repository.upsertActiveJob(userId, payload);
    const snapshot = this.toSnapshot(saved);
    return this.toResource(snapshot);
  }

  async deleteActiveJob(userId: string): Promise<void> {
    await this.repository.deleteActiveJob(userId);
  }

  private resolveJobId(existing: { jobId: string } | null, requestedJobId: string | undefined) {
    if (!existing) {
      return requestedJobId && this.isUuid(requestedJobId) ? requestedJobId : randomUUID();
    }
    if (requestedJobId && existing.jobId === requestedJobId) {
      return existing.jobId;
    }
    return randomUUID();
  }

  private sanitiseInput(input: UpsertActiveWritingDeskJobDto) {
    const trim = (value: string | undefined | null) => (typeof value === 'string' ? value : '');
    const trimNullable = (value: string | undefined) => {
      if (typeof value !== 'string') return null;
      const trimmed = value.trim();
      return trimmed.length > 0 ? trimmed : null;
    };

    const form: WritingDeskJobFormSnapshot = {
      issueDetail: trim(input.form?.issueDetail),
      affectedDetail: trim(input.form?.affectedDetail),
      backgroundDetail: trim(input.form?.backgroundDetail),
      desiredOutcome: trim(input.form?.desiredOutcome),
    };

    const followUpQuestions = Array.isArray(input.followUpQuestions)
      ? input.followUpQuestions.map((value) => trim(value))
      : [];

    const followUpAnswers = Array.isArray(input.followUpAnswers)
      ? input.followUpAnswers.map((value) => trim(value))
      : [];

    const maxFollowUps = followUpQuestions.length;
    const alignedAnswers = followUpAnswers.slice(0, maxFollowUps);
    while (alignedAnswers.length < maxFollowUps) {
      alignedAnswers.push('');
    }

    const stepIndex = Number.isFinite(input.stepIndex) && input.stepIndex >= 0 ? Math.floor(input.stepIndex) : 0;
    const followUpIndex = Number.isFinite(input.followUpIndex) && input.followUpIndex >= 0
      ? Math.min(Math.floor(input.followUpIndex), Math.max(maxFollowUps - 1, 0))
      : 0;

    return {
      phase: input.phase,
      stepIndex,
      followUpIndex,
      form,
      followUpQuestions,
      followUpAnswers: alignedAnswers,
      notes: trimNullable(input.notes),
      responseId: trimNullable(input.responseId),
    };
  }

  private toSnapshot(record: WritingDeskJobRecord): WritingDeskJobSnapshot {
    const form = this.decryptForm(record);
    const followUpAnswers = this.decryptFollowUpAnswers(record);

    const createdAt = record.createdAt instanceof Date ? record.createdAt : new Date(record.createdAt);
    const updatedAt = record.updatedAt instanceof Date ? record.updatedAt : new Date(record.updatedAt);

    return {
      jobId: record.jobId,
      userId: record.userId,
      phase: record.phase,
      stepIndex: record.stepIndex,
      followUpIndex: record.followUpIndex,
      form,
      followUpQuestions: record.followUpQuestions ?? [],
      followUpAnswers,
      notes: record.notes ?? null,
      responseId: record.responseId ?? null,
      createdAt,
      updatedAt,
    };
  }

  private decryptForm(record: WritingDeskJobRecord): WritingDeskJobFormSnapshot {
    if (record.formCiphertext) {
      try {
        return this.encryption.decryptObject<WritingDeskJobFormSnapshot>(record.formCiphertext);
      } catch {
        // fall through to legacy/plain handling
      }
    }

    if (record.form) {
      return {
        issueDetail: record.form.issueDetail ?? '',
        affectedDetail: record.form.affectedDetail ?? '',
        backgroundDetail: record.form.backgroundDetail ?? '',
        desiredOutcome: record.form.desiredOutcome ?? '',
      };
    }

    return {
      issueDetail: '',
      affectedDetail: '',
      backgroundDetail: '',
      desiredOutcome: '',
    };
  }

  private decryptFollowUpAnswers(record: WritingDeskJobRecord): string[] {
    if (record.followUpAnswersCiphertext) {
      try {
        const decrypted = this.encryption.decryptObject<string[]>(record.followUpAnswersCiphertext);
        if (Array.isArray(decrypted)) {
          return decrypted.map((value) => (typeof value === 'string' ? value : ''));
        }
      } catch {
        // fall through to legacy/plain handling
      }
    }

    if (Array.isArray(record.followUpAnswers)) {
      return record.followUpAnswers.map((value) => (typeof value === 'string' ? value : ''));
    }

    return [];
  }

  private toResource(snapshot: WritingDeskJobSnapshot): ActiveWritingDeskJobResource {
    return {
      jobId: snapshot.jobId,
      phase: snapshot.phase,
      stepIndex: snapshot.stepIndex,
      followUpIndex: snapshot.followUpIndex,
      form: snapshot.form,
      followUpQuestions: snapshot.followUpQuestions,
      followUpAnswers: snapshot.followUpAnswers,
      notes: snapshot.notes ?? null,
      responseId: snapshot.responseId ?? null,
      createdAt: snapshot.createdAt?.toISOString?.() ?? new Date().toISOString(),
      updatedAt: snapshot.updatedAt?.toISOString?.() ?? new Date().toISOString(),
    };
  }

  private isUuid(value: string) {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
  }
}
